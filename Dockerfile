FROM debian:stable-slim

# Nginx, curl এবং প্রয়োজনীয় টুলস ইনস্টল করা
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ক্লাউডফ্লেয়ার টানেল ডাউনলোড ও ইনস্টল করা
RUN curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb

# কাস্টম Nginx কনফিগারেশন কপি করা
COPY nginx.conf /etc/nginx/sites-available/default

# এন্ট্রি পয়েন্ট স্ক্রিপ্ট সেটআপ
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# পোর্ট এক্সপোজ করা (রেলওয়ে বা লোকাল টেস্টিংয়ের জন্য)
EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
