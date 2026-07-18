#!/bin/sh

echo "[*] Nginx Proxy ব্যাকগ্রাউন্ডে চালু করা হচ্ছে..."
# Nginx কে ব্যাকগ্রাউন্ড সার্ভিস হিসেবে স্টার্ট করা হলো
nginx

# টানেল টোকেন চেক করা
if [ -z "$TUNNEL_TOKEN" ]; then
    echo "=================================================="
    echo "WARNING: TUNNEL_TOKEN এনভায়রনমেন্ট ভেরিয়েবল সেট করা নেই!"
    echo "টানেল ছাড়া শুধুমাত্র লোকাল প্রক্সি হিসেবে পোর্ট 80 তে চলছে।"
    echo "=================================================="
    # কন্টেইনার সচল রাখার জন্য লগ ফাইল টেল করা হচ্ছে
    tail -f /var/log/nginx/access.log
else
    echo "[*] Cloudflare Tunnel কানেক্ট করা হচ্ছে..."
    # ক্লাউডফ্লেয়ার টানেলকে প্রধান প্রসেস (PID 1) হিসেবে রান করানো হচ্ছে
    exec cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
fi
