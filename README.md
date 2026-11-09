# Ayni

Red de ayuda mutua vecinal. El acceso habitual usa una cuenta del servidor. Las publicaciones se conservan en IndexedDB mientras vuelve la conexión.

## Probar la versión principal en un celular como PWA

Estos pasos usan la compilación compartida normal (`dist`), no el recorrido demo:

1. Ejecuta `npm run build:shared`.
2. Inicia la API en otra terminal con `npm run server`. Para probar el OTP sin enviar correos, puedes usar `npm run server:local`; ese código es solo de prueba.
3. Ejecuta `npm run preview`. La versión compilada queda disponible en el puerto `4173`, y la API se conecta por el proxy local en el puerto `4174`.
4. En la misma red Wi-Fi, abre `http://IP_DE_LA_COMPUTADORA:4173` para revisar la interfaz. Para instalarla y usar GPS en el celular, abre por **HTTPS** una URL de túnel que apunte al puerto `4173`.
5. En Android, abre el enlace HTTPS con Chrome y selecciona **Instalar aplicación** en el menú ⋮. En iPhone, ábrelo con Safari, toca **Compartir** y selecciona **Añadir a pantalla de inicio**.

Esta es la compilación de la aplicación principal, servida localmente para probarla; no despliega ni modifica el servidor de producción. Mantén activas la API, la vista previa y el túnel durante la prueba.

## Demo para presentar

En Windows, abre **Abrir demo Ayni.cmd**. Se abrirá el recorrido en http://127.0.0.1:4186/recorrido. Mantén la ventana de la terminal abierta durante la presentación. Para iniciarla manualmente, ejecuta `npm run build:demo` y después `npm run demo`. Repite la compilación cuando modifiques la demo.

El recorrido permite consultar un oficio, solicitar un préstamo y publicar una alerta de prueba. El panel permite cambiar de vecino y simular una desconexión. Los datos, la ubicación y el servidor de esta modalidad son de muestra.

En **Panel de demostración**, usa **Ubicar demo cerca de mí** para trasladar los perfiles y datos ficticios al GPS del dispositivo en ese navegador. La ubicación se queda local, no se envía al servidor y **Reiniciar demo** devuelve los datos a Lima.

## Ejecutar

Requiere Node.js 22.14 o compatible con SQLite y eliminación experimental de tipos. Ejecuta `npm ci`. En una terminal inicia `npm run server` y en otra `npm run dev`. La API carga `.env.local` si existe; las variables ya definidas en el entorno tienen prioridad. Abre http://localhost:5173. Para probar el service worker usa `npm run build` y `npm run preview`, manteniendo la API en el puerto 4174. La modalidad de demostración aislada se inicia con `npm run dev:demo`.

Configura en el proceso de la API las variables `SMTP_URL` y `MAIL_FROM` de una cuenta de correo autorizada. El registro requiere envío real y GPS. Usa HTTPS en dispositivos externos y `COOKIE_SECURE=1`. El adaptador geográfico consulta un servicio compatible con Nominatim con coordenadas aproximadas. Puedes configurar su URL mediante `REVERSE_GEOCODER_URL`. La base predeterminada es SQLite. `DATABASE_URL` selecciona PostgreSQL con PostGIS.

### Probar el registro localmente

Para probar el flujo con correo real, habilita la verificación en dos pasos de tu cuenta Google y crea una contraseña de aplicación. Copia `.env.local.example` a `.env.local`, reemplaza el correo y `YOUR_16_CHARACTER_APP_PASSWORD` por esa contraseña (sin espacios), y ejecuta `npm run server` (o `npm run server:mail`). El servidor permanece enlazado a `127.0.0.1`; el OTP se enviará al correo indicado en el registro. No uses la contraseña normal de Gmail ni compartas `.env.local`.

Si no quieres enviar correos, ejecuta `npm run server:local`; el código aparece en la terminal y es solo para pruebas, no confirma acceso real al correo. Para usar Gmail, detén ese proceso y usa `npm run server:mail` en su lugar. La API sigue local, aunque el envío de correo requiere conexión a Internet. Para probar la demo precargada sin crear cuentas, usa `npm run dev:demo` y cambia de vecino desde el panel de demostración.

## Cuenta y ubicación

| Endpoint POST bajo /api/v1 | Función |
|---|---|
| /auth/otp/send | Envía un código para registro o recuperación. Reenvío tras 60 segundos. |
| /auth/otp/verify | Verifica el código, con cinco intentos y diez minutos de vigencia, y emite un comprobante firmado. |
| /auth/register | Valida el comprobante y el GPS y crea la cuenta con contraseña bcrypt. |
| /auth/login | Abre una sesión con JWT de 15 minutos y token de renovación de siete días en cookies HttpOnly. |
| /auth/refresh y /auth/logout | Renueva el acceso o revoca la sesión. |
| /auth/reset | Cambia la contraseña con comprobante de recuperación e invalida las sesiones. |
| /location y /location/resolve | Actualiza la ubicación del perfil o detecta la zona para una publicación. |
| /profile | Guarda nombre, teléfono y foto opcional. |

La tabla `email_challenges` conserva el resumen criptográfico del código, su vencimiento, el último envío y el número de intentos. La inscripción pendiente no concede sesión. `members.profile` contiene estado de verificación, zona y coordenadas aproximadas. La API usa `GET /sync` para lectura y `POST /sync` para operaciones pendientes. Los avisos de actualización llegan por `GET /events`.

La cuenta se confirma con un código enviado al correo. En modo local, el código sale por la terminal y la confirmación es solo de prueba. No se solicita DNI, ni se verifica teléfono o identidad legal. El registro admite ubicaciones de cualquier zona; la zona detectada organiza los perfiles y las publicaciones. El GPS puede falsificarse, por lo que la residencia sigue siendo distinta y puede revisarla la coordinación vecinal. No se publica la dirección exacta.

Cada cuenta comienza con 100 puntos de bienvenida, acreditados una sola vez. Los puntos se reservan únicamente para solicitudes de favores e intercambios que los requieren; no hacen falta para publicar otros tipos de contenido.

Una cuenta existente puede activar la presidencia inicial desde **Mi perfil** ingresando el código `VECINO_CHAIR_CODE` configurado en el servidor. Solo se permite una presidencia por sector.

El inicio de sesión limita a cinco intentos por combinación de IP y correo durante 15 minutos. La combinación se guarda como HMAC en `auth_failures`; los códigos OTP también tienen vencimiento, reenvío limitado e intentos acotados. El límite general de autenticación por IP se persiste en `auth_rate_limits`, compartido por las instancias que usan la misma base de datos. El servidor también valida los campos y vencimiento de publicaciones, limita publicaciones nuevas por cuenta y evita reportes abiertos duplicados del mismo contenido.

### Despliegue controlado con Docker (opcional)

Este despliegue no es necesario para ejecutar ni terminar la versión local.

Se incluye una base de despliegue con PostgreSQL, API Node, Nginx y Caddy para obtener HTTPS automático:

1. Configura DNS `A/AAAA` de tu dominio hacia el servidor y permite los puertos 80 y 443.
2. Copia `.env.production.example` a `.env.production` en el servidor. Genera valores únicos y aleatorios para contraseñas y claves; no los compartas por chat ni los agregues al control de versiones.
3. Sustituye `AYNI_DOMAIN`, credenciales PostgreSQL, SMTP y los secretos. `AYNI_AUTH_KEY` debe mantenerse estable entre reinicios y respaldos.
4. Ejecuta `docker compose --env-file .env.production -f compose.production.yaml up --build -d`.
5. Comprueba `https://TU_DOMINIO/api/v1/health`, el envío de correo, registro, cierre de sesión, respaldo/restauración de base de datos y recuperación de servicio.

La API no publica un puerto en el host; solo recibe tráfico del proxy de confianza. Caddy termina TLS, Nginx aplica cabeceras CSP y reenvía la IP de cliente, y la API requiere `COOKIE_SECURE=1` y `TRUST_PROXY=1` en producción. La imagen de Postgres guarda datos en un volumen, pero **el volumen no es un respaldo**: programa respaldos cifrados fuera del servidor y prueba su restauración antes del piloto. Actualiza imágenes con un proceso de mantenimiento y no escales API horizontalmente sin configurar Redis para difundir cambios en tiempo real.

El despliegue solo queda listo después de reemplazar todos los valores de ejemplo, verificar DNS/correo y probar el entorno. No despliegues con credenciales de muestra.

#### Bloqueos antes de un piloto real

- El único OTP implementado es por correo. No se eligió proveedor para SMS, por lo que el teléfono no está verificado.
- El código de la terminal solo permite probar el flujo; para confirmar que alguien controla un correo se necesita correo real, lo que no es necesario para la demo local.
- La validación oficial de identidad y de teléfono no está implementada y no es requisito para usar las cuentas locales.
- Antes de probar con personas, hacer pruebas en los dispositivos objetivo, revisar accesibilidad y definir retención/borrado de datos.

## Comprobaciones y próximos pasos

Ejecuta `npm test` y `npm run test:server`. La integración de cuenta usa SQLite en memoria y sustituye el correo y el geocodificador por adaptadores de prueba. Antes del uso vecinal, comprueba entrega y recuperación en buzones reales, precisión del barrio con teléfonos del distrito y navegación con TalkBack y VoiceOver. Mide cuántas personas abandonan el registro tras la solicitud de ubicación y cuánto tardan en recibir el código.

El catálogo, recomendaciones, billetera y junta se operan desde la PWA. La aplicación nativa, la entrega geocercada FCM/APNs, la certificación WCAG y el despliegue de infraestructura distribuida quedan pendientes.

## Conversación y perfiles comunitarios

Cada publicación tiene una conversación de comentarios separada del Visto Bueno Vecinal. Los vecinos pueden reportar comentarios y coordinación puede ocultarlos desde moderación. Los mensajes privados se habilitan únicamente a las dos partes de una solicitud aceptada o en curso; al completarse, la conversación queda en modo lectura. La API vuelve a comprobar identidad, participación, estado de solicitud y límites de envío, independientemente de la interfaz.

Los perfiles públicos muestran zona aproximada, publicaciones visibles y oficio; no exponen teléfono, dirección exacta ni correo. Las alertas del mapa se agregan en celdas aproximadas de alrededor de 300 m. No es un mapa de calor avanzado y no implica seguimiento en vivo.

Comentarios y mensajes se sincronizan mediante la cola offline y se incluyen en el respaldo local. Los datos quedan guardados en el dispositivo y en la base de AYNI; no se ha integrado cifrado de extremo a extremo para el chat, por lo que no se debe compartir información altamente sensible.
