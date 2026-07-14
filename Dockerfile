FROM php:8.2-apache

RUN apt-get update && apt-get install -y libcurl4-openssl-dev \
    && docker-php-ext-install curl \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite headers setenvif

RUN { \
    echo '<VirtualHost *:80>'; \
    echo '    DocumentRoot /var/www/html'; \
    echo '    <Directory /var/www/html>'; \
    echo '        Options FollowSymLinks'; \
    echo '        AllowOverride All'; \
    echo '        Require all granted'; \
    echo '    </Directory>'; \
    echo '</VirtualHost>'; \
} > /etc/apache2/sites-available/000-default.conf

COPY . /var/www/html/

# Gera .env mínimo com BASE_PATH vazio para root deployment
RUN printf 'BASE_PATH=\nPUBLIC_BASE_URL=\nANALYTICS_STATS_CACHE_SEC=10\n' > /var/www/html/.env

RUN mkdir -p /var/www/html/data/pix \
              /var/www/html/data/analytics \
              /var/www/html/data/utmify \
    && chown -R www-data:www-data /var/www/html \
    && find /var/www/html -type f -exec chmod 644 {} \; \
    && find /var/www/html -type d -exec chmod 755 {} \;

EXPOSE 80
