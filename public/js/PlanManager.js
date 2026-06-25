/**
 * PlanManager - Handles Feature Flags and Freemium Limits securely
 * 
 * Usage:
 * await PlanManager.init(); // Call this when app starts
 * 
 * if (PlanManager.canAccessFeature('kiosk_mode')) { ... }
 */

class PlanManager {
    constructor() {
        this.permissions = {};
        this.plan = 'loading';
        this.mode = 'unknown'; // 'SAAS' or 'OPEN_SOURCE'
        this.isReady = false;

        // Default safe permissions (most restrictive) until loaded
        this.defaultPermissions = {
            'sales': true,
            'inventory': true,
            'basic_reports': true,
            'customization': false,
            'kiosk_mode': false,
            'dictation': false,
            'ticket_customization': false,
            'max_users': 1
        };

        this.readyPromise = null;
    }

    /**
     * Initializes the manager by fetching permissions from the server.
     * This ensures the client cannot simply "edit" the permissions variable
     * without the server validating it first on the backend.
     */
    async init() {
        if (this.readyPromise) return this.readyPromise;

        this.readyPromise = new Promise(async (resolve, reject) => {
            try {
                const response = await fetch('../../api/auth/permissions.php');
                if (!response.ok) throw new Error('Failed to fetch permissions');

                const data = await response.json();

                this.mode = data.mode;
                this.plan = data.plan;
                this.permissions = data.permissions || this.defaultPermissions;
                this.isReady = true;

                // Apply Plan Classes to Body
                document.body.classList.remove('plan-free', 'plan-premium', 'plan-opensource');
                document.body.classList.add(`plan-${this.plan}`);

                console.log(`[PlanManager] Initialized. Mode: ${this.mode}, Plan: ${this.plan}`);

                // Dispatch event for UI updates
                window.dispatchEvent(new CustomEvent('plan_permissions_loaded', { detail: this }));
                resolve(this);
            } catch (error) {
                console.error('[PlanManager] Error initializing:', error);
                // Fallback to defaults to not break the app
                this.permissions = this.defaultPermissions;
                this.isReady = true;
                resolve(this);
            }
        });

        return this.readyPromise;
    }

    /**
     * Check if the current plan has access to a specific feature key
     * @param {string} featureKey 
     * @returns {boolean}
     */
    canAccessFeature(featureKey) {
        if (!this.isReady) {
            console.warn('[PlanManager] Checking permission before init completely finished. Returning default.');
            return this.defaultPermissions[featureKey] || false;
        }

        // If the feature is present in the permissions object from server
        if (featureKey in this.permissions) {
            return this.permissions[featureKey] === true; // Strict boolean check
        }

        return false;
    }

    /**
     * Get the limit for a specific metric
     * @param {string} limitKey 
     * @returns {number}
     */
    getLimit(limitKey) {
        if (!this.isReady || !this.permissions) return 0;
        return this.permissions[limitKey] || 0;
    }

    /**
     * Helper to show upgrade modal or alert
     */
    showUpgradePrompt(featureName) {
        if (this.mode === 'OPEN_SOURCE') {
            // Should not happen if logic is correct, but just in case
            return;
        }

        // You can replace this with a beautiful SweetAlert
        alert(`La función "${featureName}" está disponible solo en la versión Premium. \n\n¡Actualiza tu plan para desbloquearla!`);
    }
}

// Global instance
window.PlanManager = new PlanManager();

// Auto-init if we are in a main view
document.addEventListener('DOMContentLoaded', () => {
    window.PlanManager.init();
});
