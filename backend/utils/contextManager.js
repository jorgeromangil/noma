// utils/contextManager.js
/**
 * Utilidad para manejar contextos de Dialogflow de forma consistente
 * @module contextManager
 */

class ContextManager {
  constructor(req) {
    this.session = req.body.session;
    this.contexts = req.body.queryResult.outputContexts || [];
    this.parameters = req.body.queryResult.parameters || {};
  }

  _getContextId(context) {
    const fullName = `${context?.name || ''}`;
    if (!fullName) return '';

    const marker = '/contexts/';
    const idx = fullName.lastIndexOf(marker);
    if (idx < 0) return '';

    return fullName.slice(idx + marker.length).trim();
  }

  _findContext(contextName) {
    if (!this.contexts || !Array.isArray(this.contexts)) return null;

    const target = `${contextName || ''}`.trim();
    if (!target) return null;

    // Recorremos al revés para priorizar la instancia más reciente del contexto.
    for (let i = this.contexts.length - 1; i >= 0; i -= 1) {
      const ctx = this.contexts[i];
      if (this._getContextId(ctx) === target) {
        return ctx;
      }
    }

    return null;
  }

  /**
   * Obtiene un parámetro de un contexto específico
   * @param {string} contextName - Nombre del contexto
   * @param {string} paramName - Nombre del parámetro
   * @returns {any} Valor del parámetro o null
   */
  getParam(contextName, paramName) {
    const context = this._findContext(contextName);

    if (!context || !context.parameters) return null;

    // Dialogflow a veces añade ".original" a los parámetros
        return (context.parameters[paramName] ??
          context.parameters[`${paramName}.original`] ??
          null);
  }

  /**
   * Obtiene todos los parámetros de un contexto
   * @param {string} contextName - Nombre del contexto
   * @returns {Object} Objeto con todos los parámetros
   */
  getAllParams(contextName) {
    const context = this._findContext(contextName);

    return context?.parameters || {};
  }

  /**
   * Verifica si un contexto está activo
   * @param {string} contextName - Nombre del contexto
   * @returns {boolean} true si el contexto existe y está activo
   */
  hasContext(contextName) {
    const context = this._findContext(contextName);
    return Boolean(context && Number(context.lifespanCount) > 0);
  }

  /**
   * Crea un nuevo contexto
   * @param {string} contextName - Nombre del contexto
   * @param {Object} parameters - Parámetros del contexto
   * @param {number} lifespanCount - Duración del contexto (default: 5)
   * @returns {Object} Contexto formateado para Dialogflow
   */
  createContext(contextName, parameters = {}, lifespanCount = 10) {
    return {
      name: `${this.session}/contexts/${contextName}`,
      lifespanCount: lifespanCount,
      parameters: parameters
    };
  }

  /**
   * Actualiza o crea un contexto manteniendo parámetros existentes
   * @param {string} contextName - Nombre del contexto
   * @param {Object} newParameters - Nuevos parámetros a añadir/actualizar
   * @param {number} lifespanCount - Nueva duración (default: 5)
   * @returns {Object} Contexto actualizado
   */
  updateContext(contextName, newParameters = {}, lifespanCount = 10) {
    const existingParams = this.getAllParams(contextName);
    
    return this.createContext(
      contextName,
      { ...existingParams, ...newParameters },
      lifespanCount
    );
  }

  /**
   * Elimina un contexto (estableciendo lifespan en 0)
   * @param {string} contextName - Nombre del contexto a eliminar
   * @returns {Object} Contexto con lifespan 0
   */
  deleteContext(contextName) {
    return {
      name: `${this.session}/contexts/${contextName}`,
      lifespanCount: 0
    };
  }

  /**
   * Obtiene un parámetro del contexto actual o de los parámetros de la query
   * Útil para obtener valores que pueden venir de ambos lados
   * @param {string} paramName - Nombre del parámetro
   * @param {string} contextName - Nombre del contexto (opcional)
   * @returns {any} Valor del parámetro
   */
  getParamOrContext(paramName, contextName = 'buscando-productos') {
    // Primero intentar obtener de los parámetros de la query actual
    if (this.parameters[paramName]) {
      return this.parameters[paramName];
    }
    
    // Si no está, intentar obtener del contexto
    return this.getParam(contextName, paramName);
  }

  /**
   * Construye un mensaje contextual basado en los parámetros actuales
   * @param {Object} options - Opciones para construir el mensaje
   * @returns {string} Mensaje contextual
   */
  buildContextualMessage(options) {
    const { 
      baseMessage = "Encontré",
      count = 0,
      itemType = "productos",
      producto = null,
      region = null
    } = options;

    let message = `${baseMessage} ${count} ${itemType}`;
    
    if (producto) {
      message += ` de ${producto}`;
    }
    
    if (region) {
      message += ` en ${region}`;
    }
    
    return message + ":";
  }

  /**
   * Genera chips contextuales inteligentes
   * @param {Object} currentParams - Parámetros actuales
   * @returns {Array} Array de opciones para chips
   */
  generateContextualChips(currentParams = {}) {
    const chips = [];
    const { producto, region } = currentParams;

    if (region) {
      chips.push({ text: `Más de ${region}` });
    }

    if (producto) {
      chips.push({ text: `${producto} en otras provincias` });
    }

    // Chips genéricos
    if (!producto && !region) {
      chips.push(
        { text: "Buscar por provincia" },
        { text: "Ver productos populares" }
      );
    }

    chips.push({ text: "Contactar artesano" });

    return chips;
  }

  /**
   * Log de debugging para contextos
   * @param {string} intentName - Nombre del intent actual
   */
  logContext(intentName) {
  }
}

module.exports = ContextManager;