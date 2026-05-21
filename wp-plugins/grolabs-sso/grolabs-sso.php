<?php
/**
 * Plugin Name: GroLabs SSO
 * Plugin URI:  https://grolabs.ai/
 * Description: Conversion-optimized single sign-on for WordPress. Tiered provider buttons, smart ordering, locale-aware labels, in-app browser rescue, passkey support.
 * Version:     0.1.0
 * Author:      GroLabs
 * License:     GPL-2.0-or-later
 * Text Domain: grolabs-sso
 */

if (!defined('ABSPATH')) {
    exit;
}

define('GROLABS_SSO_VERSION', '0.1.0');
define('GROLABS_SSO_PATH', plugin_dir_path(__FILE__));
define('GROLABS_SSO_URL', plugin_dir_url(__FILE__));

require_once GROLABS_SSO_PATH . 'src/Surfaces/LoginScreen.php';
require_once GROLABS_SSO_PATH . 'src/Auth/GoogleHandler.php';

\GroLabs\SSO\Surfaces\LoginScreen::register();
\GroLabs\SSO\Auth\GoogleHandler::register();
