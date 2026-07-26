// Netlify Function: /.netlify/functions/chat
//
// Recibe { system, messages } del navegador, llama a la API de Anthropic con la
// API key guardada en las variables de entorno de Netlify, y devuelve la
// respuesta. La API key NUNCA llega al navegador del visitante.

const ANTHROPIC_URL = 'https://api.anthropic.com';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1000;

// El límite de una función síncrona en Netlify es 60s. Cortamos antes para
// poder devolver un error legible en vez de dejar la petición colgada.
const UPSTREAM_TIMEOUT_MS = 45000;

// Máximo de turnos y caracteres por turno, para evitar abuso.
const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (status, payload) => Response.json(payload, { status, headers: CORS_HEADERS });

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Método no permitido.' });
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY no está disponible en el runtime de la función.');
    return json(500, {
      error: 'Falta configurar ANTHROPIC_API_KEY en las variables de entorno de Netlify (con scope Functions/Runtime).'
    });
  }

  // Netlify AI Gateway inyecta ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL en el
  // runtime. Ese token SOLO es válido contra ANTHROPIC_BASE_URL, no contra
  // api.anthropic.com. Si la variable existe la usamos; si no, se asume que la
  // key es de Anthropic y se llama a la API pública directamente.
  const baseUrl = (Netlify.env.get('ANTHROPIC_BASE_URL') || ANTHROPIC_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/messages`;

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Solicitud inválida: el cuerpo no es JSON válido.' });
  }

  const { system, messages } = payload ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'Faltan mensajes.' });
  }

  const trimmedMessages = messages
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim() !== ''
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_CHARS_PER_MESSAGE)
    }));

  if (trimmedMessages.length === 0) {
    return json(400, { error: 'No se recibió ningún mensaje válido.' });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: typeof system === 'string' ? system : '',
        messages: trimmedMessages
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });

    const rawBody = await upstream.text();

    let data = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      // Se registra el estado y el mensaje de error, nunca la API key.
      console.error(`Anthropic devolvió ${upstream.status}:`, rawBody.slice(0, 500));
      return json(upstream.status, {
        error: data?.error?.message || `Anthropic devolvió el estado ${upstream.status}.`
      });
    }

    if (!data) {
      console.error('Anthropic devolvió una respuesta que no es JSON válido.');
      return json(502, { error: 'Respuesta inesperada de Anthropic.' });
    }

    return json(200, data);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.error('Fallo al contactar Anthropic:', error?.name, error?.message);

    return json(timedOut ? 504 : 502, {
      error: timedOut
        ? 'Anthropic tardó demasiado en responder. Por favor intenta de nuevo.'
        : 'No se pudo conectar con Anthropic. Por favor intenta de nuevo.'
    });
  }
};
