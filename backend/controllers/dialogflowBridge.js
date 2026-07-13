const dialogflow = require('@google-cloud/dialogflow');
const intentHandler = require('./dialogflow'); // Tu controlador del switch

// Configuración de Google
const sessionClient = new dialogflow.SessionsClient({
  keyFilename: './google-credentials.json' 
});

const projectId = 'small-talk-kygk'; 

/**
 * HELPERS: Transforman el formato complejo de Google (Protobuf) a objetos JS normales
 */
const valueToJson = (value) => {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('numberValue' in value) return value.numberValue;
  if ('boolValue' in value) return value.boolValue;
  if (value.structValue) return structToJson(value.structValue);
  if (value.listValue && Array.isArray(value.listValue.values)) {
    return value.listValue.values.map(valueToJson);
  }
  return value;
};

const structToJson = (struct) => {
  if (!struct || !struct.fields) return {};
  const out = {};
  for (const [key, val] of Object.entries(struct.fields)) {
    out[key] = valueToJson(val);
  }
  return out;
};

/**
 * EXPORTACIÓN DEL MIDDLEWARE BRIDGE
 */
module.exports = async (req, res) => {
  try {
    // 1. Extraemos datos con valores por defecto para evitar errores "undefined"
    // Si tu Angular envía { "text": "hola" }, lo pillamos de req.body.text
    const text = req.body.text || req.body.queryResult?.queryText;
    const sessionFromFront = req.body.session;

    if (!text) {
      return res.status(400).json({ fulfillmentText: "No se recibió texto para procesar." });
    }

    // 2. Gestión de Sesión: Si no viene del front, creamos una para que no explote .split()
    const sessionId = sessionFromFront 
      ? sessionFromFront.split('/').pop() 
      : 'session-id-' + Math.random().toString(36).substring(7);
    
    const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

    // 3. Procesamiento de Contextos entrantes
    const incomingContextsRaw =
      req.body.outputContexts ||
      req.body.queryResult?.outputContexts ||
      [];

    const normalizeContextsToSession = (contexts, targetSessionPath) => {
      if (!Array.isArray(contexts)) return [];
      return contexts
        .filter((c) => c && typeof c === 'object')
        .map((c) => {
          const name = c.name || '';
          const parts = name.split('/contexts/');
          const contextId = parts.length === 2 ? parts[1] : name;
          return {
            ...c,
            name: `${targetSessionPath}/contexts/${contextId}`,
          };
        });
    };

    const incomingContexts = normalizeContextsToSession(incomingContextsRaw, sessionPath);

    // 4. Petición a Dialogflow
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: text,
          languageCode: 'es',
        },
      },
      queryParams: {
        contexts: incomingContexts,
      },
    };

    const [response] = await sessionClient.detectIntent(request);
    const result = response.queryResult;

    // 5. Normalización de la respuesta de Google
    const normalizedParameters = structToJson(result.parameters);
    const normalizedOutputContexts = Array.isArray(result.outputContexts)
      ? result.outputContexts.map((c) => ({
          ...c,
          parameters: structToJson(c.parameters),
        }))
      : [];

    // 5.1) IMPORTANTE: Dialogflow no siempre devuelve en result.outputContexts
    // los contextos que se envían como queryParams.contexts (input contexts).
    // Como en este proyecto persistimos estado desde el frontend, necesitamos
    // que el handler (dialogflow.js + intents) pueda leer esos contextos.
    // Por eso los mezclamos: los de Dialogflow tienen prioridad.
    const mergeContextsByName = (base = [], override = []) => {
      const map = new Map();

      for (const c of Array.isArray(base) ? base : []) {
        if (c?.name) map.set(c.name, c);
      }

      for (const c of Array.isArray(override) ? override : []) {
        if (!c?.name) continue;

        const prev = map.get(c.name);
        if (!prev) {
          map.set(c.name, c);
          continue;
        }

        // Merge superficial + merge de parámetros para no perder estado del front (offset/total)
        const prevParams = (prev && typeof prev.parameters === 'object' && prev.parameters) ? prev.parameters : {};
        const nextParams = (c && typeof c.parameters === 'object' && c.parameters) ? c.parameters : {};

        map.set(c.name, {
          ...prev,
          ...c,
          parameters: {
            ...prevParams,
            ...nextParams,
          },
        });
      }

      return Array.from(map.values());
    };

    const mergedContextsForHandlers = mergeContextsByName(incomingContexts, normalizedOutputContexts);

    // 6. RECONSTRUCCIÓN DEL BODY: Aquí "engañamos" al siguiente controlador
    // para que crea que es una petición directa de Dialogflow
    req.body.session = sessionPath;
    req.body.queryResult = {
      queryText: result.queryText,
      intent: result.intent,
      parameters: normalizedParameters,
      fulfillmentText: result.fulfillmentText,
      fulfillmentMessages: result.fulfillmentMessages,
      allRequiredParamsPresent: result.allRequiredParamsPresent,
      outputContexts: mergedContextsForHandlers,
      intentDetectionConfidence: result.intentDetectionConfidence,
      languageCode: result.languageCode
    };

    // 7. Llamada al switch de lógica (dialogflow.js)
    return intentHandler(req, res);

  } catch (error) {
    console.error('❌ ERROR CRÍTICO EN EL BRIDGE:', error);
    res.status(500).json({ 
      fulfillmentText: 'Error en la conexión con el servidor del bot.' 
    });
  }
};