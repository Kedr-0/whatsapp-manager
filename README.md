# 💬 MultiWhats — Gestor Multi-Cuenta de WhatsApp

Aplicación de escritorio (Windows) para gestionar **3 o más cuentas de WhatsApp a la vez**,
con ventanas **acopladas en una sola interfaz** y una **suite de mensajes rápidos** lista para copiar.

Hecha con **Electron**. Cada cuenta corre en su propia sesión (pestaña/partición) de WhatsApp Web,
así que puedes iniciar sesión con códigos QR distintos en cada una.

---

## ✨ Características

- **Multi-cuenta**: agrega cuentas ilimitadas, cada una con sesión independiente y persistente
  (siguen conectadas al reiniciar la app).
- **Mensajes rápidos**: suite con plantillas predefinidas en español (Saludos, Seguimiento,
  Promociones, Ventas, Pagos, Respuestas rápidas) + **editor propio** (crear, editar, eliminar,
  categorizar y buscar) con **copiado de 1 clic** y confirmación visual.
- **Estado en vivo**: punto verde (conectada), ámbar (esperando QR), gris (cargando) + contador
  de mensajes sin leer por cuenta.
- **Silenciar por cuenta**: silencia el audio de una cuenta sin afectar a las demás.
- **Tema oscuro** moderno estilo WhatsApp.
- Los datos (cuentas, distribución, plantillas) se guardan automáticamente.

---

## 🚀 Instalación y uso

1. Ten instalado **Node.js** (LTS): https://nodejs.org
2. Doble clic en **`instalar.bat`** (solo la primera vez) para descargar dependencias.
3. Doble clic en **`iniciar.bat`** para abrir la app.
4. En la barra lateral pulsa **"＋ Agregar cuenta"** y escanea el código QR con el teléfono
   de esa cuenta (Ajustes → Dispositivos vinculados → Vincular dispositivo).
5. Repite para cada cuenta que quieras gestionar.

> 💡 Alternativa manual: `npm install` y luego `npm start` dentro de esta carpeta.

---

## 🎯 Cómo se usa

| Acción | Cómo |
|---|---|
| Agregar cuenta | Botón **＋ Agregar cuenta** (barra lateral) |
| Ajustar tamaño de una cuenta | Enfócala (clic en su tarjeta) y usa los botones **Zoom − / Auto / +** de la barra superior. El zoom automático encoge WhatsApp para que quepa sin que los mensajes se pisen. |
| Copiar un mensaje rápido | Clic en **📋 Copiar** de la plantilla → listo para pegar en WhatsApp |
| Crear tu propio mensaje | **＋ Nuevo mensaje** dentro del panel de mensajes rápidos |
| Silenciar cuenta | Icono 🔇 en la tarjeta de la cuenta |
| Eliminar cuenta | Icono 🗑 en la tarjeta (cierra su sesión de WhatsApp) |
| Abrir/cerrar panel de mensajes | Botón **Mensajes rápidos** o `Ctrl+P` |
| Atajos | `Ctrl+1`…`Ctrl+9` para enfocar cada cuenta |

---

## 🗂️ Datos guardados

- Cuentas, distribución de ventanas y plantillas: se guardan en la carpeta de datos de la app
  (`%APPDATA%\multiwatts`), no en la carpeta del proyecto.
- Eliminar una cuenta borra también su sesión local de WhatsApp Web.

---

## ⚠️ Notas

- WhatsApp permite vincular hasta 4 dispositivos por cuenta; usar más cuentas de las que
  WhatsApp permite por número es responsabilidad del usuario.
- Cada ventana es WhatsApp Web oficial (https://web.whatsapp.com). No se automatiza el envío
  de mensajes; solo se facilita copiar plantillas que tú editas.
- La app es de uso local: no se envían tus datos a ningún servidor.

---

## 🛠️ Solución de problemas

**La app no se abre / se cierra sola:**

1. Asegúrate de tener **Node.js** instalado (https://nodejs.org, versión LTS).
2. Ejecuta primero **`instalar.bat`** y espera a que termine (descarga Electron, ~150 MB la primera vez).
3. Luego abre **`iniciar.bat`**. Si sale un mensaje de error, la consola se queda abierta para que lo leas.
4. Si el problema persiste, revisa el archivo de registro **`%APPDATA%\multiwatts\startup.log`**
   y envíalo si necesitas ayuda.

**La ventana aparece pero no se ve el QR:**

- Espera unos segundos: WhatsApp Web tarda en cargar la primera vez.
- Si dice "Cargando…" mucho tiempo, revisa tu conexión a internet (WhatsApp Web necesita red).

**Botón "Agregar cuenta" no hace nada:**

- Asegúrate de haber ejecutado `instalar.bat` una vez.
- Revisa `startup.log` por errores.

**Datos y carpetas:** la app guarda cuentas y plantillas en `%APPDATA%\multiwatts\`.
Para empezar de cero, cierra la app y borra esa carpeta.
