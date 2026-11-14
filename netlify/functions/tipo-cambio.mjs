// Tipo de cambio oficial para tudinerousa.com
// Mexico: Banco de Mexico, SIE API, serie SF43718 (FIX, pesos por dolar).
// Needs the BANXICO_TOKEN environment variable (scope: Functions).
// The CDN caches the answer for 1 hour. If Banxico fails we return no number (never an invented one).

const BANXICO = "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718"
const ALLOWED = ["https://tudinerousa.com", "https://www.tudinerousa.com"]

function headersFor(req, ok) {
  const h = { "Content-Type": "application/json; charset=utf-8" }
  const origin = req.headers.get("origin") || ""
  if (ALLOWED.includes(origin)) { h["Access-Control-Allow-Origin"] = origin; h["Vary"] = "Origin" }
  h["Netlify-CDN-Cache-Control"] = ok ? "public, durable, s-maxage=3600, stale-while-revalidate=21600" : "no-store"
  h["Cache-Control"] = ok ? "public, max-age=600" : "no-store"
  return h
}

async function mexico(token) {
  const headers = { "Bmx-Token": token, "Accept": "application/json" }
  const [r1, r2] = await Promise.all([fetch(BANXICO + "/datos/oportuno", { headers }), fetch(BANXICO, { headers })])
  if (!r1.ok) throw new Error("Banxico HTTP " + r1.status)
  const datos = await r1.json()
  const meta = r2.ok ? await r2.json() : null
  const serie = datos && datos.bmx && datos.bmx.series && datos.bmx.series[0]
  const dato = serie && serie.datos && serie.datos[0]
  if (!dato || !dato.dato || dato.dato === "N/E") throw new Error("Banxico sin dato")
  const valor = Number(String(dato.dato).replace(/,/g, ""))
  if (!isFinite(valor) || valor <= 0) throw new Error("Banxico dato invalido")
  const p = String(dato.fecha).split("/")
  return {
    pais: "MX", moneda: "MXN", nombre: "Peso mexicano", tipo: "FIX",
    valor, fecha: p[2] + "-" + p[1] + "-" + p[0],
    serie: "SF43718",
    titulo: (meta && meta.bmx && meta.bmx.series && meta.bmx.series[0] && meta.bmx.series[0].titulo) || null,
    fuente: "Banco de México",
    fuente_url: "https://www.banxico.org.mx/tipcamb/tipCamMIAction.do?idioma=sp"
  }
}

export default async (req) => {
  const token = Netlify.env.get("BANXICO_TOKEN")
  const paises = {}
  const errores = []
  if (!token) errores.push("Falta BANXICO_TOKEN")
  else {
    try { paises.MX = await mexico(token) } catch (e) { errores.push(String(e && e.message)) }
  }
  const ok = Object.keys(paises).length > 0
  const body = JSON.stringify({ actualizado: new Date().toISOString(), paises, errores })
  return new Response(body, { status: ok ? 200 : 503, headers: headersFor(req, ok) })
}

export const config = { path: "/api/tipo-cambio" }
