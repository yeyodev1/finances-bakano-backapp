import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { param } from "../utils/expressHandler.util";
import { CustomError } from "../errors/customError.error";
import { env } from "../config/env";
import { receiptUploadService } from "../services/receiptUpload.service";

/**
 * Página pública (el token firmado ES la autorización) para subir el
 * comprobante de un pago desde un enlace que entrega el MCP del equipo.
 */

const esc = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function pagina(contenido: string): string {
  const b = env.brand;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Subir comprobante</title>
<link rel="icon" href="${b.iconUrl}" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
<style>
  :root { --primary: ${b.primary}; --dark: ${b.primaryDark}; --light: ${b.primaryLight}; --green: ${b.green}; --error: ${b.error}; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--light); color: var(--dark);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 28px 24px; width: 100%; max-width: 440px;
    box-shadow: 0 10px 30px rgba(25, 20, 35, 0.08); }
  .logo { height: 30px; display: block; margin: 0 auto 18px; }
  h1 { font-size: 1.05rem; margin: 0 0 4px; text-align: center; }
  .sub { font-size: 0.8rem; color: #6b6577; text-align: center; margin: 0 0 18px; }
  .pago { display: flex; justify-content: space-between; gap: 10px; font-size: 0.85rem;
    padding: 10px 12px; border: 1px solid rgba(25, 20, 35, 0.08); border-radius: 10px; margin-bottom: 8px; }
  .pago strong { font-size: 0.9rem; }
  .pago .detalle { color: #6b6577; font-size: 0.75rem; }
  .ya { color: var(--green); font-size: 0.72rem; font-weight: 700; }
  .zona { margin-top: 14px; border: 2px dashed rgba(25, 20, 35, 0.2); border-radius: 12px;
    padding: 28px 16px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .zona.activa, .zona:hover { border-color: var(--primary); background: rgba(230, 40, 92, 0.04); }
  .zona i { font-size: 1.5rem; color: var(--primary); display: block; margin-bottom: 8px; }
  .zona p { margin: 0; font-size: 0.85rem; font-weight: 600; }
  .zona span { font-size: 0.72rem; color: #6b6577; }
  .nombre { margin-top: 10px; font-size: 0.8rem; color: var(--dark); word-break: break-all; }
  button { margin-top: 16px; width: 100%; background: var(--primary); color: #fff; border: none;
    border-radius: 10px; padding: 12px; font-size: 0.9rem; font-weight: 700; cursor: pointer; font-family: inherit; }
  button:disabled { opacity: 0.5; cursor: default; }
  .msj { margin-top: 14px; font-size: 0.85rem; text-align: center; display: none; }
  .msj.ok { color: var(--green); display: block; }
  .msj.mal { color: var(--error); display: block; }
  .centro { text-align: center; }
  .centro i { font-size: 2rem; margin-bottom: 10px; display: block; }
  .centro i.ok { color: var(--green); }
  .centro i.mal { color: var(--error); }
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="${b.logoUrl}" alt="${b.appName}" />
  ${contenido}
</div>
</body>
</html>`;
}

export const ver = asyncHandler(async (req: Request, res: Response) => {
  const token = param(req, "token");
  let datos;
  try {
    datos = await receiptUploadService.datos(token);
  } catch (error) {
    const mensaje = error instanceof CustomError ? error.message : "No se pudo abrir este enlace.";
    res
      .status(error instanceof CustomError ? error.status : 400)
      .send(
        pagina(
          `<div class="centro"><i class="fa-solid fa-link-slash mal" aria-hidden="true"></i><h1>Enlace no disponible</h1><p class="sub">${esc(mensaje)}</p></div>`
        )
      );
    return;
  }

  const filas = datos.pagos
    .map(
      (p) => `<div class="pago">
  <div><strong>${esc(p.cliente)}</strong><div class="detalle">Período ${esc(p.periodo)} · ${new Date(p.fecha).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric" })}</div></div>
  <div style="text-align:right"><strong>$${p.monto.toFixed(2)}</strong>${p.tieneComprobante ? '<div class="ya"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Ya tiene comprobante</div>' : ""}</div>
</div>`
    )
    .join("");

  const reemplaza = datos.pagos.some((p) => p.tieneComprobante)
    ? "<p class='sub'>Algún pago ya tiene comprobante: si subes otro, lo reemplaza.</p>"
    : "";

  res.send(
    pagina(`
  <h1>Subir comprobante del pago</h1>
  <p class="sub">Imagen o PDF. Este enlace vence en ${esc(datos.vigencia)}.</p>
  ${filas}
  ${reemplaza}
  <form id="f">
    <div class="zona" id="zona">
      <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
      <p>Arrastra el archivo aquí</p>
      <span>o toca para elegirlo (máx. 10 MB)</span>
      <div class="nombre" id="nombre"></div>
      <input type="file" id="archivo" name="file" accept="image/*,.pdf,application/pdf" hidden />
    </div>
    <button type="submit" id="boton" disabled>Subir comprobante</button>
    <div class="msj" id="msj"></div>
  </form>
  <script>
    var zona = document.getElementById('zona');
    var input = document.getElementById('archivo');
    var boton = document.getElementById('boton');
    var nombre = document.getElementById('nombre');
    var msj = document.getElementById('msj');
    zona.addEventListener('click', function () { input.click(); });
    ['dragover', 'dragenter'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('activa'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('activa'); });
    });
    zona.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; cambio(); }
    });
    input.addEventListener('change', cambio);
    function cambio() {
      var a = input.files && input.files[0];
      nombre.textContent = a ? a.name : '';
      boton.disabled = !a;
      msj.className = 'msj';
    }
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var a = input.files && input.files[0];
      if (!a) return;
      boton.disabled = true;
      boton.textContent = 'Subiendo…';
      var datos = new FormData();
      datos.append('file', a);
      fetch(window.location.href, { method: 'POST', body: datos })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error((r.j && r.j.message) || 'No se pudo subir.');
          document.querySelector('.card').innerHTML =
            '<div class="centro"><i class="fa-solid fa-circle-check ok" aria-hidden="true"></i>' +
            '<h1>Comprobante subido</h1><p class="sub">Ya quedó pegado al pago. Puedes cerrar esta página.</p></div>';
        })
        .catch(function (err) {
          boton.disabled = false;
          boton.textContent = 'Subir comprobante';
          msj.className = 'msj mal';
          msj.textContent = err.message || 'No se pudo subir. Intenta de nuevo.';
        });
    });
  </script>`)
  );
});

export const subir = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file?.buffer) {
    throw new CustomError("Falta el archivo del comprobante (campo 'file').", 400);
  }
  const resultado = await receiptUploadService.subir(param(req, "token"), {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
  });
  res.status(200).json(resultado);
});
