/**
 * Cliente API - Manejo de peticiones HTTP
 * Tomodachi POS System
 */

const API = {
    baseURL: 'http://localhost/Tomodachi',
    
    /**
     * Realizar petición GET
     */
    async get(endpoint, params = {}) {
        const url = new URL(this.baseURL + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });
        
        return await response.json();
    },
    
    /**
     * Realizar petición POST
     */
    async post(endpoint, data = {}) {
        const response = await fetch(this.baseURL + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        return await response.json();
    },
    
    /**
     * Realizar petición PUT
     */
    async put(endpoint, data = {}) {
        const response = await fetch(this.baseURL + endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        return await response.json();
    },
    
    /**
     * Realizar petición DELETE
     */
    async delete(endpoint, data = {}) {
        const response = await fetch(this.baseURL + endpoint, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        return await response.json();
    }
};
