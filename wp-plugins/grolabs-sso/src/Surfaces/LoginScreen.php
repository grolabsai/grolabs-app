<?php
/**
 * Renders the GroLabs SSO login surface on wp-login.php.
 *
 * Hooks:
 *   - login_enqueue_scripts → load CSS, JS, and the SVG sprite
 *   - login_form            → render markup above the default WP form
 *   - login_footer          → boot the JS with site config
 *
 * The plugin doesn't replace the default wp-login form — it renders
 * the GroLabs surface above it. The default form remains as the ultimate
 * fallback (and the password fields the JS submits to are wp-login.php's).
 */

namespace GroLabs\SSO\Surfaces;

if (!defined('ABSPATH')) {
    exit;
}

class LoginScreen
{
    public static function register(): void
    {
        add_action('login_enqueue_scripts', [self::class, 'enqueue']);
        add_action('login_form',            [self::class, 'render']);
        add_action('login_footer',          [self::class, 'boot']);

        // Also expose via shortcode for in-page login forms (theme integration)
        add_shortcode('grolabs_sso', [self::class, 'shortcode']);
    }

    public static function enqueue(): void
    {
        wp_enqueue_style(
            'grolabs-sso',
            GROLABS_SSO_URL . 'assets/css/login-screen.css',
            [],
            GROLABS_SSO_VERSION
        );

        wp_enqueue_script(
            'grolabs-sso',
            GROLABS_SSO_URL . 'assets/js/login-screen.js',
            [],
            GROLABS_SSO_VERSION,
            true
        );
    }

    public static function render(): void
    {
        // Render the SVG sprite (inlined so <use href="#logo-..."> resolves)
        $sprite = file_get_contents(GROLABS_SSO_PATH . 'assets/provider-logos.svg');
        if ($sprite) {
            echo $sprite;
        }

        // Container — JS targets this id
        echo '<div id="grolabs-sso-root"></div>';

        // Hide the default WP form (it's still in the DOM as fallback,
        // and our JS submits to wp-login.php's action URL).
        echo '<style>#loginform { display: none; } #login h1, .login #nav, .login #backtoblog { display: none; }</style>';
    }

    public static function boot(): void
    {
        $config = self::buildClientConfig();
        ?>
        <script>
        (function () {
            if (!window.GroLabsSSO) return;
            GroLabsSSO.init(<?php echo wp_json_encode($config); ?>);
        })();
        </script>
        <?php
    }

    public static function shortcode(array $atts = []): string
    {
        // Allow embedding in arbitrary pages
        wp_enqueue_style('grolabs-sso');
        wp_enqueue_script('grolabs-sso');

        $config = self::buildClientConfig();
        $id     = 'grolabs-sso-' . wp_generate_uuid4();
        $sprite = file_get_contents(GROLABS_SSO_PATH . 'assets/provider-logos.svg') ?: '';

        ob_start();
        ?>
        <?php echo $sprite; ?>
        <div id="<?php echo esc_attr($id); ?>"></div>
        <script>
        (function () {
            if (!window.GroLabsSSO) return;
            var cfg = <?php echo wp_json_encode($config); ?>;
            cfg.root = '#<?php echo esc_js($id); ?>';
            GroLabsSSO.init(cfg);
        })();
        </script>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * Build the JS init payload from site settings.
     *
     * In v0 this reads from a single options key. A future admin UI will
     * write to the same key, so this stays stable.
     */
    private static function buildClientConfig(): array
    {
        $settings = get_option('grolabs_sso_settings', []);
        $locale   = self::resolveLocale();
        $redirectTo = isset($_REQUEST['redirect_to']) ? wp_unslash($_REQUEST['redirect_to']) : admin_url();

        $config = [
            'root'              => '#grolabs-sso-root',
            'lang'              => $locale,
            'passwordPostUrl'   => site_url('wp-login.php', 'login_post'),
            'passwordNonce'     => '', // wp-login.php doesn't require a nonce on the primary login form
            'redirectTo'        => $redirectTo,
            'forgotUrl'         => wp_lostpassword_url($redirectTo),
            'registerUrl'       => get_option('users_can_register') ? wp_registration_url() : '',
        ];

        // Provider order override
        if (!empty($settings['order']) && is_array($settings['order'])) {
            $config['config'] = ['order' => array_values($settings['order'])];
        }

        // Google client id (frontend OAuth) + REST verification endpoint
        if (!empty($settings['google_client_id'])) {
            $config['googleClientId']    = $settings['google_client_id'];
            $config['googleRedirectUri'] = wp_login_url($redirectTo);
            $config['googleVerifyUrl']   = rest_url('grolabs-sso/v1/google');
        }

        // Apple-on-non-Apple override
        if (!empty($settings['apple_always'])) {
            $config['applyEverywhere'] = ['apple'];
        }

        return $config;
    }

    private static function resolveLocale(): string
    {
        $wp_locale = get_locale(); // e.g. en_US, es_ES
        $short     = strtolower(substr($wp_locale, 0, 2));
        return in_array($short, ['en', 'es'], true) ? $short : 'en';
    }
}
