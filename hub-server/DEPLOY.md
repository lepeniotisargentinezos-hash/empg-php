# Deploy na VPS

## 1. Subir os arquivos
Zipar a pasta `hub-server/` e enviar para a VPS (via scp, FileZilla, painel, etc.).

## 2. Na VPS — instalar Node.js (se não tiver)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

## 3. Configurar a senha
```bash
cp .env.example .env
nano .env
# Edite: HUB_SECRET=sua_senha_forte_aqui
# PORT=3001 (ou outra porta)
```

## 4. Iniciar com PM2 (mantém rodando após fechar SSH)
```bash
npm install -g pm2
pm2 start server.js --name hub
pm2 startup    # gera o comando para rodar no boot — rode o comando que aparecer
pm2 save
```

## 5. Acessar
```
http://IP_DA_VPS:3001
```

## 6. Atualizar o código no futuro
```bash
# Enviar novos arquivos via scp/painel
pm2 restart hub
```

## Opcional — Nginx como proxy (para usar porta 80/443)
```nginx
server {
    listen 80;
    server_name hub.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Opcional — SSL com Let's Encrypt
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d hub.seudominio.com
```
