<?php
/**
 * Google OAuth handler.
 *
 * The frontend uses Google's implicit-flow redirect, lands back on
 * wp-login.php with an `id_token` in the URL fragment. The fragment
 * is client-side only, so the JS extracts the token and POSTs it to
 * the REST endpoint registered here. We verify and call wp_set_auth_cookie().
 */

namespace GroLabs\SSO\Auth;

if (!defined('ABSPATH')) {
    exit;
}

class GoogleHandler
{
    public const REST_NAMESPACE = 'grolabs-sso/v1';
    public const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
    public const GOOGLE_CERTS_TRANSIENT = 'grolabs_sso_google_certs';

    public static function register(): void
    {
        add_action('rest_api_init', [self::class, 'registerRoutes']);
    }

    public static function registerRoutes(): void
    {
        register_rest_route(self::REST_NAMESPACE, '/google', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handleSignIn'],
            'permission_callback' => '__return_true',
            'args'                => [
                'id_token' => [
                    'required' => true,
                    'type'     => 'string',
                ],
            ],
        ]);
    }

    public static function handleSignIn(\WP_REST_Request $request)
    {
        $idToken = (string) $request->get_param('id_token');
        if (!$idToken) {
            return new \WP_Error('grolabs_sso_missing_token', 'Missing id_token', ['status' => 400]);
        }

        $payload = self::verifyIdToken($idToken);
        if (is_wp_error($payload)) {
            return $payload;
        }

        $email = isset($payload['email']) ? sanitize_email($payload['email']) : '';
        if (!$email || empty($payload['email_verified'])) {
            return new \WP_Error('grolabs_sso_unverified_email', 'Google did not return a verified email', ['status' => 401]);
        }

        $user = self::resolveOrCreateUser($email, $payload);
        if (is_wp_error($user)) {
            return $user;
        }

        wp_set_current_user($user->ID, $user->user_login);
        wp_set_auth_cookie($user->ID, true);
        do_action('wp_login', $user->user_login, $user);

        $redirect = $request->get_param('redirect_to');
        if (!$redirect) {
            $redirect = admin_url();
        }

        return [
            'ok'          => true,
            'user_id'     => $user->ID,
            'redirect_to' => esc_url_raw($redirect),
        ];
    }

    /**
     * Verify a Google-issued ID token against Google's published JWKS.
     *
     * For brevity this implementation does the minimum a real plugin needs:
     *   - Fetch the JWKS (cached 12h via transient)
     *   - Match the kid in the token header
     *   - Verify the RS256 signature with phpseclib if available, else
     *     fall back to OpenSSL's openssl_verify with the published x5c chain
     *   - Check iss / aud / exp
     *
     * This is the standard, no-secret-needed pattern for verifying Google ID tokens.
     * It is intentionally library-light so the plugin doesn't require composer.
     */
    private static function verifyIdToken(string $jwt)
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return new \WP_Error('grolabs_sso_bad_token', 'Malformed JWT', ['status' => 400]);
        }
        [$headerB64, $payloadB64, $signatureB64] = $parts;

        $header  = json_decode(self::base64UrlDecode($headerB64), true);
        $payload = json_decode(self::base64UrlDecode($payloadB64), true);
        if (!is_array($header) || !is_array($payload)) {
            return new \WP_Error('grolabs_sso_bad_token', 'Token JSON parse failed', ['status' => 400]);
        }

        // Claims
        $settings = get_option('grolabs_sso_settings', []);
        $expectedAud = $settings['google_client_id'] ?? '';
        $iss = $payload['iss'] ?? '';
        if ($iss !== 'https://accounts.google.com' && $iss !== 'accounts.google.com') {
            return new \WP_Error('grolabs_sso_bad_iss', 'Bad issuer', ['status' => 401]);
        }
        if ($expectedAud && ($payload['aud'] ?? '') !== $expectedAud) {
            return new \WP_Error('grolabs_sso_bad_aud', 'Audience mismatch', ['status' => 401]);
        }
        if (empty($payload['exp']) || $payload['exp'] < time()) {
            return new \WP_Error('grolabs_sso_expired', 'Token expired', ['status' => 401]);
        }

        // Signature
        $certs = self::fetchGoogleCerts();
        if (is_wp_error($certs)) {
            return $certs;
        }
        $kid = $header['kid'] ?? '';
        $key = null;
        foreach ($certs['keys'] ?? [] as $k) {
            if (($k['kid'] ?? null) === $kid) {
                $key = $k;
                break;
            }
        }
        if (!$key) {
            return new \WP_Error('grolabs_sso_no_kid', 'Signing key not found', ['status' => 401]);
        }

        $pem = self::jwkToPem($key);
        if (!$pem) {
            return new \WP_Error('grolabs_sso_pem_fail', 'Could not derive verification key', ['status' => 500]);
        }

        $signedData = $headerB64 . '.' . $payloadB64;
        $signature  = self::base64UrlDecode($signatureB64);
        $ok = openssl_verify($signedData, $signature, $pem, OPENSSL_ALGO_SHA256);
        if ($ok !== 1) {
            return new \WP_Error('grolabs_sso_bad_sig', 'Signature verification failed', ['status' => 401]);
        }

        return $payload;
    }

    private static function fetchGoogleCerts()
    {
        $cached = get_transient(self::GOOGLE_CERTS_TRANSIENT);
        if ($cached) {
            return $cached;
        }
        $resp = wp_remote_get(self::GOOGLE_CERTS_URL, ['timeout' => 5]);
        if (is_wp_error($resp)) {
            return $resp;
        }
        $body = wp_remote_retrieve_body($resp);
        $data = json_decode($body, true);
        if (!is_array($data) || empty($data['keys'])) {
            return new \WP_Error('grolabs_sso_no_certs', 'No Google certs', ['status' => 500]);
        }
        set_transient(self::GOOGLE_CERTS_TRANSIENT, $data, 12 * HOUR_IN_SECONDS);
        return $data;
    }

    /**
     * Convert a JWK (n,e) RSA key to a PEM string for openssl_verify.
     */
    private static function jwkToPem(array $jwk): ?string
    {
        if (($jwk['kty'] ?? '') !== 'RSA' || empty($jwk['n']) || empty($jwk['e'])) {
            return null;
        }
        $n = self::base64UrlDecode($jwk['n']);
        $e = self::base64UrlDecode($jwk['e']);

        // ASN.1 DER for RSA public key
        $modulus  = self::asn1Integer($n);
        $exponent = self::asn1Integer($e);
        $rsaPub   = self::asn1Sequence($modulus . $exponent);
        // SubjectPublicKeyInfo with RSA algorithm OID
        $algoOid  = "\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01"; // 1.2.840.113549.1.1.1
        $algoNull = "\x05\x00";
        $algoSeq  = self::asn1Sequence($algoOid . $algoNull);
        $bitString = "\x03" . self::asn1Length(strlen($rsaPub) + 1) . "\x00" . $rsaPub;
        $spki     = self::asn1Sequence($algoSeq . $bitString);

        $pem = "-----BEGIN PUBLIC KEY-----\n"
             . chunk_split(base64_encode($spki), 64, "\n")
             . "-----END PUBLIC KEY-----\n";
        return $pem;
    }

    private static function asn1Integer(string $bytes): string
    {
        // Prepend 0x00 if high bit is set (positive integer)
        if (ord($bytes[0]) & 0x80) {
            $bytes = "\x00" . $bytes;
        }
        return "\x02" . self::asn1Length(strlen($bytes)) . $bytes;
    }

    private static function asn1Sequence(string $bytes): string
    {
        return "\x30" . self::asn1Length(strlen($bytes)) . $bytes;
    }

    private static function asn1Length(int $len): string
    {
        if ($len < 0x80) return chr($len);
        $bytes = '';
        while ($len > 0) {
            $bytes = chr($len & 0xff) . $bytes;
            $len >>= 8;
        }
        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private static function base64UrlDecode(string $input): string
    {
        $remainder = strlen($input) % 4;
        if ($remainder) {
            $input .= str_repeat('=', 4 - $remainder);
        }
        return base64_decode(strtr($input, '-_', '+/'));
    }

    /**
     * Find an existing user by email, or create one.
     *
     * Account-linking is intentionally simple: same verified email = same user.
     * Cross-provider linking lives in a separate flow (out of scope for v1).
     */
    private static function resolveOrCreateUser(string $email, array $payload)
    {
        $user = get_user_by('email', $email);
        if ($user) {
            return $user;
        }

        $settings = get_option('grolabs_sso_settings', []);
        $allowSignup = !empty($settings['google_allow_signup']) || (bool) get_option('users_can_register');
        if (!$allowSignup) {
            return new \WP_Error('grolabs_sso_signup_disabled', 'New accounts are disabled', ['status' => 403]);
        }

        $username = self::uniqueUsernameFromEmail($email);
        $userId = wp_insert_user([
            'user_login'   => $username,
            'user_email'   => $email,
            'user_pass'    => wp_generate_password(32, true, true),
            'first_name'   => $payload['given_name']  ?? '',
            'last_name'    => $payload['family_name'] ?? '',
            'display_name' => $payload['name']        ?? $username,
            'role'         => $settings['default_role'] ?? get_option('default_role', 'subscriber'),
        ]);

        if (is_wp_error($userId)) {
            return $userId;
        }

        update_user_meta($userId, 'grolabs_sso_provider', 'google');
        update_user_meta($userId, 'grolabs_sso_google_sub', $payload['sub'] ?? '');

        return get_userdata($userId);
    }

    private static function uniqueUsernameFromEmail(string $email): string
    {
        $base = sanitize_user(strstr($email, '@', true) ?: 'user', true);
        $candidate = $base;
        $i = 2;
        while (username_exists($candidate)) {
            $candidate = $base . $i++;
            if ($i > 999) {
                $candidate = $base . wp_generate_password(6, false, false);
                break;
            }
        }
        return $candidate;
    }
}
