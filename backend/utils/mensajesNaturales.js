// utils/mensajesNaturales.js
/**
 * Utilidad para generar mensajes más naturales y variados
 */

class MensajesNaturales {
  /**
   * Genera un mensaje de bienvenida variado
   */
  static bienvenida() {
    const mensajes = [
      "¡Hola! 👋 ¿Qué producto artesanal estás buscando hoy?",
      "¡Bienvenido! ¿En qué puedo ayudarte a encontrar?",
      "¡Hola! Cuéntame, ¿qué te gustaría descubrir hoy?",
      "¡Hey! ¿Buscas algo en especial?"
    ];
    return this._getRandom(mensajes);
  }

  /**
   * Genera mensaje cuando encuentra productos
   */
  static productosEncontrados(count, producto, region = null) {
    if (count === 0) {
      return this.sinResultados(producto, region);
    }

    const templates = region ? [
      `¡Perfecto! Encontré ${count} ${this._pluralize('producto', count)} de ${producto} en ${region} 🎯`,
      `¡Genial! Tengo ${count} ${this._pluralize('opción', count, 'opciones')} de ${producto} en ${region}.`,
      `Mira esto 👀 ${count} ${producto} de ${region} que te pueden interesar`,
      `¡Excelente elección! ${count} ${producto} de ${region} disponibles`,
      `He encontrado ${count} ${this._pluralize('producto', count)} de ${producto} en ${region} para ti`
    ] : [
      `¡Perfecto! Encontré ${count} ${this._pluralize('producto', count)} de ${producto} 🎯`,
      `¡Genial! Tengo ${count} ${this._pluralize('opción', count, 'opciones')} de ${producto}.`,
      `Mira esto 👀 ${count} ${producto} que te pueden interesar`,
      `¡Excelente elección! ${count} ${producto} ${this._pluralize('disponible', count, 'disponibles')}`,
      `He encontrado ${count} ${this._pluralize('producto', count)} de ${producto} para ti`
    ];

    return this._getRandom(templates);
  }

  /**
   * Mensaje cuando no hay resultados
   */
  static sinResultados(producto, region = null) {
    const templates = region ? [
      `Vaya... no encontré ${producto} en ${region} 😔`,
      `Lo siento, no tengo ${producto} disponible en ${region} ahora mismo`,
      `Hmm, parece que no hay ${producto} en ${region} por el momento`,
      `No hay ${producto} en ${region} disponible, pero déjame mostrarte alternativas`
    ] : [
      `Vaya... no encontré ${producto} 😔`,
      `Lo siento, no tengo ${producto} disponible ahora mismo`,
      `Hmm, parece que no hay ${producto} por el momento`,
      `No tengo ${producto} disponible, pero déjame mostrarte alternativas`
    ];

    return this._getRandom(templates);
  }

  /**
   * Mensaje al cambiar de región
   */
  static cambioRegion(producto, region) {
    const templates = [
      `¡Cambiando de zona! Aquí tienes ${producto} de ${region}`,
      `Perfecto, te muestro ${producto} de ${region} 📍`,
      `¡Vale! Vamos con ${producto} de ${region}`,
      `Explorando ${region}... Aquí está el ${producto} que buscas`
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje al cambiar de producto
   */
  static cambioProducto(productoNuevo, region = null) {
    const templates = region ? [
      `¡Cambiando de producto! Te muestro ${productoNuevo} de ${region}`,
      `Perfecto, ahora buscamos ${productoNuevo} en ${region} 🔄`,
      `¡Vale! Vamos con ${productoNuevo} de ${region}`,
      `Explorando ${productoNuevo} en ${region}...`
    ] : [
      `¡Cambiando de producto! Te muestro ${productoNuevo}`,
      `Perfecto, ahora buscamos ${productoNuevo} 🔄`,
      `¡Vale! Vamos con ${productoNuevo}`,
      `Explorando ${productoNuevo}...`
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje al mostrar más productos
   */
  static verMas(count, producto, region = null) {
    const templates = region ? [
      `¡Aquí tienes ${count} ${this._pluralize('producto', count)} más de ${producto} en ${region}!`,
      `Te muestro ${count} ${this._pluralize('opción', count, 'opciones')} adicionales de ${producto} en ${region}`,
      `Más ${producto} de ${region} para ti: ${count} productos`,
      `¡Sigo encontrando tesoros! ${count} ${producto} más de ${region}`
    ] : [
      `¡Aquí tienes ${count} ${this._pluralize('producto', count)} más de ${producto}!`,
      `Te muestro ${count} ${this._pluralize('opción', count, 'opciones')} adicionales de ${producto}`,
      `Más ${producto} para ti: ${count} productos`,
      `¡Sigo encontrando tesoros! ${count} ${producto} más`
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje al mostrar artesanos
   */
  static artesanosEncontrados(count, producto = null, region = null) {
    if (producto && region) {
      const templates = [
        `¡Encontré ${count} ${this._pluralize('artesano', count)} especializados en ${producto} en ${region}! 👨‍🎨`,
        `Genial, ${count} ${this._pluralize('artesano', count)} de ${producto} en ${region}.`,
        `Te presento ${count} ${this._pluralize('artesano', count)} que ${count > 1 ? 'trabajan' : 'trabaja'} ${producto} en ${region}`,
        `¡Conoce a ${count > 1 ? 'estos' : 'este'} ${count} ${this._pluralize('artesano', count)} de ${producto} en ${region}!`
      ];
      return this._getRandom(templates);
    } else if (producto) {
      const templates = [
        `¡Encontré ${count} ${this._pluralize('artesano', count)} especializados en ${producto}! 👨‍🎨`,
        `Te presento ${count} ${this._pluralize('artesano', count)} que ${count > 1 ? 'trabajan' : 'trabaja'} ${producto}`,
        `¡Conoce a ${count > 1 ? 'estos' : 'este'} ${count} ${this._pluralize('artesano', count)} de ${producto}!`
      ];
      return this._getRandom(templates);
    } else {
      const templates = [
        `¡Encontré ${count} ${this._pluralize('artesano', count)}! 👨‍🎨`,
        `Te presento ${count} ${this._pluralize('artesano', count)} talentosos`,
        `¡Conoce a ${count > 1 ? 'estos' : 'este'} ${count} ${this._pluralize('artesano', count)}!`
      ];
      return this._getRandom(templates);
    }
  }

  /**
   * Mensaje al resetear búsqueda
   */
  static resetear() {
    const templates = [
      "¡Perfecto! Empecemos de nuevo. ¿Qué te gustaría buscar? 🔍",
      "¡Vale! ¿Qué exploramos ahora?",
      "¡Listo! Cuéntame, ¿qué buscas?",
      "Perfecto, nueva búsqueda. ¿Qué producto te interesa?"
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje de despedida
   */
  static despedida() {
    const templates = [
      "¡Hasta pronto! Espero haberte ayudado 👋",
      "¡Nos vemos! Vuelve cuando quieras 😊",
      "¡Adiós! Que disfrutes de tu compra",
      "¡Hasta la próxima! Aquí estaré cuando me necesites"
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje de error genérico
   */
  static error() {
    const templates = [
      "Ups... algo salió mal. ¿Puedes intentarlo de nuevo? 🤔",
      "Vaya, tuve un pequeño problema. ¿Reformulas la pregunta?",
      "Lo siento, no pude procesar eso. ¿Me lo dices de otra forma?",
      "Hmm, no entendí bien. ¿Puedes decirlo de otra manera?"
    ];
    return this._getRandom(templates);
  }

  /**
   * Mensaje cuando el usuario dice gracias
   */
  static agradecimiento() {
    const templates = [
      "¡De nada! ¿Necesitas algo más? 😊",
      "¡Un placer ayudarte! ¿Algo más?",
      "¡Para eso estoy! ¿Te ayudo con algo más?",
      "¡Encantado de ayudar! ¿Buscas algo más?"
    ];
    return this._getRandom(templates);
  }

  // ========== MÉTODOS PRIVADOS ==========

  /**
   * Obtiene un elemento aleatorio del array
   */
  static _getRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Pluraliza una palabra según el conteo
   */
  static _pluralize(word, count, pluralForm = null) {
    if (count === 1) {
      return word;
    }
    
    // Si se proporciona forma plural específica
    if (pluralForm) {
      return pluralForm;
    }

    // Reglas simples de pluralización en español
    if (word.endsWith('z')) {
      return word.slice(0, -1) + 'ces';
    }
    if (word.endsWith('ón')) {
      return word.slice(0, -2) + 'ones';
    }
    if (word.endsWith('vocal')) {
      return word + 's';
    }
    
    // Por defecto, añadir 's'
    return word + 's';
  }
}

module.exports = MensajesNaturales;