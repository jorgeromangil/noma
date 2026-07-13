// utils/sugerenciasProactivas.js
/**
 * Sistema de sugerencias inteligentes basadas en el contexto
 */

class SugerenciasProactivas {
  /**
   * Genera sugerencias según el estado de la conversación
   */
  static generar(contexto) {
    const { 
      producto, 
      region, 
      ultima_busqueda, 
      resultados_count 
    } = contexto;

    // Caso 1: Tiene producto pero no región
    if (producto && !region) {
      return {
        mensaje: `¿Sabías que puedo ayudarte a encontrar ${producto} en tu provincia favorita?`,
        chips: [
          { text: `${producto} en mi zona` },
          { text: `Ver todas las provincias` },
          { text: `Conocer artesanos de ${producto}` },
          { text: `Ver más ${producto}` }
        ]
      };
    }

    // Caso 2: Tiene producto Y región
    if (producto && region) {
      return {
        mensaje: `¿Te gustaría explorar más opciones de ${producto}?`,
        chips: [
          { text: `${producto} en otra provincia` },
          { text: `Cambiar de producto` },
          { text: `Artesanos de ${region}` },
          { text: `Productos destacados de ${region}` }
        ]
      };
    }

    // Caso 3: Solo tiene región
    if (region && !producto) {
      return {
        mensaje: `Hay muchos productos artesanales en ${region}. ¿Qué te interesa?`,
        chips: [
          { text: `Vino de ${region}` },
          { text: `Cerámica de ${region}` },
          { text: `Queso de ${region}` },
          { text: `Artesanos de ${region}` }
        ]
      };
    }

    // Caso 4: Sin contexto - sugerencias generales
    return {
      mensaje: "¿Qué te gustaría explorar hoy?",
      chips: [
        { text: "Productos populares" },
        { text: "Explorar por provincia" },
        { text: "Conocer artesanos" },
        { text: "Productos con certificación" }
      ]
    };
  }

  /**
   * Sugerencias después de ver productos
   */
  static despuesDeProductos(producto, region, count) {
    if (count === 0) {
      return {
        mensaje: `No encontré lo que buscabas. ¿Qué tal si probamos...?`,
        chips: [
          { text: "Buscar en otra provincia" },
          { text: "Ver productos similares" },
          { text: "Ver productos populares" },
          { text: "Notificarme cuando haya" }
        ]
      };
    }

    if (count < 3) {
      return {
        mensaje: `Encontré pocos resultados. ¿Quieres ampliar la búsqueda?`,
        chips: region ? [
          ...(producto ? [{ text: `${producto} en otras provincias` }] : []),
          { text: `Más productos de ${region}` },
          { text: "Ver productos similares" },
          { text: "Contactar artesano" }
        ] : [
          { text: "Filtrar por provincia" },
          { text: "Ver productos similares" },
          { text: "Conocer artesanos" },
          { text: "Ver todos los productos" }
        ]
      };
    }

    // Muchos resultados
    return {
      mensaje: `¡Hay muchas opciones! ¿Cómo quieres continuar?`,
      chips: region ? [
        { text: "Ver más productos" },
        { text: "Filtrar por precio" },
        { text: `Artesanos de ${region}` },
        { text: "Solo con certificación" }
      ] : [
        { text: "Ver más productos" },
        { text: "Filtrar por provincia" },
        { text: "Filtrar por precio" },
        { text: "Conocer artesanos" }
      ]
    };
  }

  /**
   * Sugerencias después de ver artesanos
   */
  static despuesDeArtesanos(producto, region) {
    return {
      mensaje: "¿Qué te gustaría hacer ahora?",
      chips: [
        { text: `Ver productos de ${producto || 'estos artesanos'}` },
        { text: "Contactar artesano" },
        { text: "Ver mapa de artesanos" },
        { text: "Buscar en otra provincia" }
      ]
    };
  }

  /**
   * Sugerencias al inicio de la conversación
   */
  static bienvenida() {
    return {
      mensaje: "¡Hola! Te ayudo a descubrir productos artesanales únicos. ¿Por dónde empezamos?",
      chips: [
        { text: "¿Qué me recomiendas?" },
        { text: "Productos de mi zona" },
        { text: "Buscar algo específico" },
        { text: "Conocer artesanos" }
      ]
    };
  }

  /**
   * Sugerencias cuando el usuario parece perdido
   */
  static ayuda() {
    return {
      mensaje: "Puedo ayudarte a encontrar productos artesanales de toda España. Por ejemplo:",
      chips: [
        { text: "Buscar vino de La Rioja" },
        { text: "Ver cerámica de Valencia" },
        { text: "Encontrar queso artesanal" },
        { text: "Productos cerca de mí" }
      ]
    };
  }

  /**
   * Sugerencias según el momento del día
   */
  static segunHora() {
    const hora = new Date().getHours();
    
    if (hora >= 5 && hora < 12) {
      // Mañana
      return {
        mensaje: "¡Buenos días! Perfecto momento para descubrir productos artesanales frescos",
        chips: [
          { text: "Ver quesos artesanales" },
          { text: "Productos gourmet" },
          { text: "Cerámica para café" }
        ]
      };
    } else if (hora >= 12 && hora < 20) {
      // Tarde
      return {
        mensaje: "¡Buenas tardes! ¿Exploramos productos únicos?",
        chips: [
          { text: "Ver vinos artesanales" },
          { text: "Explorar cerámica" },
          { text: "Regalos originales" }
        ]
      };
    } else {
      // Noche
      return {
        mensaje: "¡Buenas noches! Relájate explorando artesanía única",
        chips: [
          { text: "Vinos para disfrutar" },
          { text: "Decoración artesanal" },
          { text: "Ideas para regalar" }
        ]
      };
    }
  }

  /**
   * Sugerencias basadas en popularidad
   */
  static trending(productosTrending) {
    return {
      mensaje: "Esto está de moda esta semana:",
      chips: (productosTrending || []).map(p => ({
        text: `${this._getEmoji(p)} ${p}`
      }))
    };
  }

  static _getEmoji(producto) {
    const map = {
      'vino': '🍷', 'queso': '🧀', 'ceramica': '🏺', 'alfareria': '🏺',
      'textil': '🧵', 'miel': '🍯', 'aceite': '🫒', 'madera': '🪵',
      'jamon': '🥩', 'embutido': '🌭'
    };
    const key = `${producto || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return map[key] || '🎁';
  }

}

module.exports = SugerenciasProactivas;