# AxSoft Contable

Sistema de gestión **mobile-first** y **multi-negocio** para emprendedores: ventas, stock, gastos, pedidos, agenda, caja, pagos, producción, sueldos y contador de visitas. Pensado para venderse a varios negocios, cada uno con sus datos y sus usuarios totalmente separados.

## Stack
Node.js 20 LTS · Express 4 · SQLite (better-sqlite3) · EJS · PM2 · Nginx + Let's Encrypt

## Roles
- **Superadmin (vos, AxSoft):** da de alta cada negocio y su dueña. Entra en `/plataforma`.
- **Dueña del negocio:** ve el panel (caja, pagos, producción, sueldos, contador) y da de alta empleadas.
- **Empleada:** carga ventas, stock, gastos, pedidos y agenda. No ve la caja.

La separación entre negocios es por `negocio_id` en cada tabla: un negocio nunca ve datos de otro.

---

## Puesta en marcha (local)
```bash
npm install
cp .env.example .env      # editá SESSION_SECRET y las credenciales
npm run init-db           # crea la base + superadmin + negocio demo
npm start                 # http://localhost:3000
```

### Usuarios demo (creados por init-db)
| Rol        | Usuario   | Clave      |
|------------|-----------|------------|
| Superadmin | `admin`   | `axsoft123`|
| Dueña      | `duena`   | `duena123` |
| Empleada   | `adriana` | `vende123` |

> **Cambiá estas claves antes de producción.** Podés fijar las del superadmin con las variables `SUPERADMIN_USER` / `SUPERADMIN_PASS` en `.env` antes de correr `init-db`.

---

## Despliegue en VPS (Ubuntu + Nginx + PM2 + SSL)

```bash
# 1. Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Código y dependencias
cd /var/www/axsoft-contable
npm install --omit=dev
cp .env.example .env && nano .env        # PONÉ un SESSION_SECRET largo y aleatorio
npm run init-db

# 3. PM2
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup                               # seguí la instrucción que imprime

# 4. Nginx
sudo cp nginx.conf.example /etc/nginx/sites-available/axsoft-contable
sudo nano /etc/nginx/sites-available/axsoft-contable   # poné tu dominio
sudo ln -s /etc/nginx/sites-available/axsoft-contable /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. SSL con Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Generar un `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Copias de seguridad
La base entera es el archivo `db/axsoft.db`. Para respaldar en caliente (con WAL):
```bash
sqlite3 db/axsoft.db ".backup 'backup-$(date +%F).db'"
```
Programalo en un `cron` diario.

## Notas técnicas
- **PM2 con 1 sola instancia** (fork). No usar modo cluster: SQLite es un archivo y no admite múltiples escritores en paralelo.
- Las sesiones se guardan en `db/sessions.db` (sobreviven reinicios).
- La app confía en el proxy (`trust proxy`) para que las cookies `secure` funcionen detrás de Nginx con SSL.
- Es una app **online** (renderizada en el servidor, muy liviana). El trabajo offline total de la feria queda como mejora futura (Fase 2), porque requiere sincronización del lado del navegador.
