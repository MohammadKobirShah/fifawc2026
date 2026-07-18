FROM debian:stable-slim

# Nginx, curl এবং প্রয়োজনীয় টুলস ইনস্টল করা
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Nginx logs কে সরাসরি Docker console (stdout/stderr) এ রিডাইরেক্ট করা যাতে Railway logs এ সব দেখা যায়
RUN ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

# ক্লাউডফ্লেয়ার টানেল ডাউনলোড ও ইনস্টল করা
RUN curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i cloudflared.deb \
    && rm cloudflared.deb

# কাস্টম Nginx কনফিগারেশন কপি করা
COPY nginx.conf /etc/nginx/sites-available/default

# এন্ট্রি পয়েন্ট স্ক্রিপ্ট সেটআপ
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# পোর্ট ৮০ এক্সপোজ করা
EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
