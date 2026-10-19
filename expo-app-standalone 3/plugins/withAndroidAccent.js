const { withAndroidColors, withAndroidStyles } = require('expo/config-plugins');

// Same blue as the chat's own message bubble (chatOwnBubble in constants/colors.ts).
const ACCENT = '#0062D1';

function upsertColor(resources, name, value) {
  const entries = (resources.color = resources.color || []);
  const existing = entries.find((entry) => entry.$ && entry.$.name === name);
  if (existing) existing._ = value;
  else entries.push({ $: { name }, _: value });
}

/**
 * Android's default theme accent is teal, which leaks into native chrome:
 * switch thumbs, TextInput carets, selection handles and ripples. Pin the
 * theme to the product blue so those controls match the design system.
 */
function withAndroidAccent(config) {
  config = withAndroidColors(config, (cfg) => {
    upsertColor(cfg.modResults.resources, 'colorAccent', ACCENT);
    return cfg;
  });

  config = withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources.style || [];
    const appTheme = styles.find((style) => style.$ && style.$.name === 'AppTheme');
    if (appTheme) {
      appTheme.item = appTheme.item || [];
      for (const name of ['colorAccent', 'android:colorAccent', 'colorControlActivated']) {
        const existing = appTheme.item.find((item) => item.$ && item.$.name === name);
        if (existing) existing._ = ACCENT;
        else appTheme.item.push({ $: { name }, _: ACCENT });
      }
    }
    return cfg;
  });

  return config;
}

module.exports = withAndroidAccent;
