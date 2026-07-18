#!/bin/sh

echo "[*] Nginx Proxy চালু করা হচ্ছে..."
# Nginx কে ব্যাকগ্রাউন্ডে রান করানো হচ্ছে
nginx -g 'daemon off;' &

# টানেল টোকেন চেক করা
if [ -z "$TUNNEL_TOKEN" ]; then
    echo "=================================================="
    echo "WARNING: TUNNEL_TOKEN এনভায়রনমেন্ট ভেরিয়েবল সেট করা নেই!"
    echo "টানেল ছাড়া শুধুমাত্র লোকাল প্রক্সি হিসেবে পোর্ট 80 তে চলছে।"
    echo "=================================================="
    # কন্টেইনার সচল রাখার জন্য ওয়েট স্টেটমেন্ট
    wait -n
else
    echo "[*] Cloudflare Tunnel কানেক্ট করা হচ্ছে..."
    # ক্লাউডফ্লেয়ার টানেলকে ফোরগ্রাউন্ডে রান করানো হচ্ছে
    exec cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
fi
