# Intercambio Cultural Mundial

Sitio web y formulario de postulaciones. Express sirve la página, PostgreSQL guarda los registros y Resend envía las notificaciones a la dirección configurada en el entorno.

## Publicación con Render

Este directorio debe ser la raíz de un repositorio Git remoto (GitHub, GitLab o Bitbucket) que se conecte a Render. Render lee `render.yaml` desde la raíz del repositorio y crea el servicio y su base PostgreSQL.

En Render, completa `RESEND_API_KEY`, `FROM_EMAIL` y `NOTIFICATION_EMAIL` como variables secretas antes de desplegar. Resend requiere un dominio de envío verificado para mandar notificaciones desde una dirección propia; configura el remitente con una dirección de ese dominio. Configura `NOTIFICATION_EMAIL` con el correo que recibirá las postulaciones.

El Blueprint deja la base en plan gratuito para evitar cargos automáticos. Ese plan vence 30 días después de crear la base; después los datos quedan inaccesibles y, al terminar el periodo de gracia de 14 días, se eliminan. Para guardar postulaciones de forma continua hay que elegir un plan de base de datos de pago antes de aplicar el Blueprint. Las funciones web gratuitas también pueden suspenderse por inactividad.

## Ejecución local

1. Instala Node.js 20 o superior.
2. Copia `.env.example` a `.env` y completa una URL PostgreSQL, una clave Resend y un remitente verificado.
3. Ejecuta `npm install` y `npm start`.
4. Abre `http://localhost:3000`.

El servidor crea la tabla `applications` al iniciar. La ruta `/api/health` informa si la aplicación está activa.

## Privacidad y protección

El formulario solo acepta solicitudes con correo válido y consentimiento explícito. Se guardan nombre, edad, correo, país, idioma, modalidad y respuestas en PostgreSQL. La notificación de cada solicitud incluye esos datos y se envía a la dirección indicada. No incluyas credenciales en este repositorio. Para abrir el formulario públicamente conviene añadir CAPTCHA y un proceso para gestionar solicitudes de eliminación de datos.
