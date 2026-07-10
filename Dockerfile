FROM php:8.2-apache

RUN apt-get update && apt-get install -y libcurl4-openssl-dev \
    && docker-php-ext-install curl \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite headers setenvif

RUN echo '<Directory /var/www/html>\n\
    AllowOverride All\n\
    Require all granted\n\
</Directory>' > /etc/apache2/conf-available/credpix.conf \
    && a2enconf credpix

COPY . /var/www/html/

RUN mkdir -p /var/www/html/data/pix \
              /var/www/html/data/analytics \
              /var/www/html/data/utmify \
    && chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html/data

EXPOSE 80
