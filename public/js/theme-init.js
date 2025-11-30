(function() {
    const savedTheme = localStorage.getItem('pos_theme_config');
    if (savedTheme) {
        try {
            const themeConfig = JSON.parse(savedTheme);
            const varMap = {
                'primary_color': '--primary-color',
                'secondary_color': '--secondary-color',
                'success_color': '--success-color',
                'danger_color': '--danger-color',
                'warning_color': '--warning-color',
                'info_color': '--info-color',
                'dark_color': '--dark-color',
                'bg_body': '--bg-body',
                'text_color': '--text-color'
            };
            
            const root = document.documentElement;
            for (const [key, value] of Object.entries(themeConfig)) {
                if (varMap[key] && value) {
                    root.style.setProperty(varMap[key], value);
                }
            }
        } catch (e) {
            console.error('Error applying theme from cache:', e);
        }
    }
})();