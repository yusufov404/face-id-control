# OpenCode uchun prompt — FaceSys Enterprise serverga joylash (24/7)

Quyidagi matnni serverdagi OpenCode agentiga (yoki terminaliga) to'liq nusxalab bering.
Manzil: Kali Linux server, `172.10.1.192` (Tailscale: `100.98.102.77`).

---

## PROMPT (nusxalash uchun)

```text
Sen FaceSys Enterprise loyihasini Kali Linux serverga (172.10.1.192) joylaydigan
OpenCode agentisan. Server: Kali 2026.2, PostgreSQL 18, nginx, systemd.
Loyiha: klinika HR + Face ID davomat tizimi (FastAPI + PostgreSQL + React/Vite).

MAQSAD: yangi versiyani o'rnatib, 24/7 to'xtamay ishlaydigan holatga keltirish.
Hech narsani o'chirib tashlamasdan oldin ZAXIRA ol. Har qadamdan keyin natijani tekshir.

0) TAYYORGARLIK
   - `id`, `df -h`, `free -h`, `systemctl status facesys --no-pager`, `psql --version`,
     `nginx -v` bilan mavjud holatni yozib ol.
   - Agar /etc/facesys/facesys.env mavjud bo'lsa, uni O'CHIRMA va o'zgartirmasdan saqla.
   - ZAXIRA:
       mkdir -p /var/backups/facesys
       STAMP=$(date +%Y%m%d_%H%M%S)
       # baza (env fayldagi DATABASE_* qiymatlari bilan)
       set -a; . /etc/facesys/facesys.env; set +a
       PGPASSWORD="$DATABASE_PASSWORD" pg_dump -h "${DATABASE_HOST:-127.0.0.1}" \
         -U "$DATABASE_USER" -d "$DATABASE_NAME" -Fc \
         -f /var/backups/facesys/db_$STAMP.dump
       tar czf /var/backups/facesys/code_$STAMP.tgz -C /opt facesys 2>/dev/null || true
     Backup hajmi 0 bo'lmasligini tekshir (`ls -lh`).

1) KOD
   - Kod manbasi: https://github.com/yusufov404/face-id-control (public).
   - Agar /opt/facesys git kloni bo'lsa: `git -C /opt/facesys fetch --all && git -C /opt/facesys reset --hard origin/main`
     (faqat shu katalogda; boshqa hech narsani reset qilma).
   - Aks holda: `git clone https://github.com/yusufov404/face-id-control /opt/facesys`
   - `.env` fayllari repoda yo'q — ularni yaratma, `/etc/facesys/facesys.env` dan foydalan.

2) BACKEND
   - `python3 -m venv /opt/facesys/venv` (mavjud bo'lsa qayta yaratma)
   - `/opt/facesys/venv/bin/pip install -r /opt/facesys/backend/requirements.txt`
     (pandas ham shu ro'yxatda; o'rnatilganini tekshir: `python -c "import pandas"`)
   - Migratsiya:
       cd /opt/facesys/database/migrations
       set -a; . /etc/facesys/facesys.env; set +a
       /opt/facesys/venv/bin/alembic upgrade head
       /opt/facesys/venv/bin/alembic current    # 0003_active_user_uniqueness bo'lishi kerak

3) FRONTEND BUILD
   - `cd /opt/facesys/frontend && npm ci && npm run build`
   - Natija: /opt/facesys/frontend/dist/index.html va assets/ papkasi mavjudligini tekshir.

4) RUXSATLAR
   - `chown -R facesys:facesys /opt/facesys`
   - `chmod -R a+rX /opt/facesys/frontend/dist` (nginx www-data o'qiy olishi uchun)

5) systemd (24/7 kafolati)
   - /etc/systemd/system/facesys.service faylini quyidagicha yoz:
       [Unit]
       Description=FaceSys Enterprise API
       After=network-online.target postgresql.service
       Wants=network-online.target

       [Service]
       Type=simple
       User=facesys
       Group=facesys
       WorkingDirectory=/opt/facesys/backend
       EnvironmentFile=/etc/facesys/facesys.env
       ExecStart=/opt/facesys/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
       Restart=always
       RestartSec=3
       StartLimitIntervalSec=0
       StandardOutput=journal
       StandardError=journal
       SyslogIdentifier=facesys

       [Install]
       WantedBy=multi-user.target
   - `systemctl daemon-reload && systemctl enable facesys && systemctl restart facesys`
   - `systemctl is-enabled facesys` -> enabled; `systemctl is-active facesys` -> active

6) Health-check taymer (qo'shimcha himoya)
   - /usr/local/bin/facesys-healthcheck.sh:
       #!/usr/bin/env bash
       if ! curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null; then
         systemctl restart facesys
         logger -t facesys-health "health check failed, service restarted"
       fi
   - chmod +x. facesys-healthcheck.service (Type=oneshot) + facesys-healthcheck.timer
     (OnUnitActiveSec=2min, OnBootSec=2min). `systemctl enable --now facesys-healthcheck.timer`

7) nginx
   - Root: /opt/facesys/frontend/dist, `try_files $uri $uri/ /index.html;`
   - `/api/` -> proxy_pass http://127.0.0.1:8000; `client_max_body_size 20m;`
   - `/health` -> proxy_pass http://127.0.0.1:8000/health;
   - `nginx -t && systemctl reload nginx`

8) TEKSHIRUV (hammasi bajarilishi shart, natijalarni yoz)
   - `curl -s http://127.0.0.1:8000/health` -> {"status":"ok",...}
   - `curl -s -o /dev/null -w "%{http_code}" http://172.10.1.192/` -> 200
   - `curl -s -o /dev/null -w "%{http_code}" http://172.10.1.192/api/v1/auth/me` -> 401 (token yo'q, demak API tirik)
   - HTML ichida yangi bundle borligini tekshir: `curl -s http://172.10.1.192/ | grep -o 'assets/index-[^"]*\.js'`
   - `journalctl -u facesys -n 50 --no-pager` da ERROR/Traceback yo'qligini tekshir
   - `systemctl is-enabled facesys` va `systemctl is-active facesys`
   - `reboot` qilmasdan: `systemctl show facesys -p Restart` -> always

9) YAKUNIY HISOBOT
   Quyidagilarni jadval ko'rinishida yoz:
   - backup fayllari yo'li va hajmi
   - `alembic current` natijasi
   - servis holati (enabled/active), Restart=always
   - health-check va UI javoblari (HTTP kodlar)
   - yangi frontend bundle nomi
   - agar biror qadam bajarilmagan bo'lsa, aniq sababi

XAVFSIZLIK QOIDALARI:
- `/etc/facesys/facesys.env` mazmunini hech qayerga chiqarma, logga yozma, git'ga qo'shma.
- Bazani DROP qilma, `--clean` bilan restore qilma (faqat nosozlikda, backupdan keyin).
- Parolni chatga yoki faylga yozma.
```

---

## Eslatma

Skript ko'rinishidagi variant repoda: `deployment/update.sh` (backup + migratsiya +
restart + avtomatik rollback). OpenCode buni ham ishlatishi mumkin:

```bash
sudo bash deployment/update.sh
```
