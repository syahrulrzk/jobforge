#!/bin/bash
# Test Clearbit (primary) + Google s2 (fallback) for candidate real Indonesian companies
DOMAINS="tokopedia.com bukalapak.com shopee.co.id blibli.com lazada.co.id gojek.com traveloka.com tiket.com grab.com ruangguru.com zenius.net halodoc.com alodokter.com dana.id ovo.id kredivo.com midtrans.com stockbit.com ajaib.co.id jtexpress.id sicepat.com anteraja.id ninjavan.co telkomsel.com xl.co.id detik.com kompas.com kumparan.com idntimes.com glints.com efishery.com agate.id pasarpolis.com sayurbox.com kalibrr.com"

printf "%-22s %-8s %-10s %-8s %-10s\n" "DOMAIN" "CB" "CB_BYTES" "G" "G_BYTES"
for d in $DOMAINS; do
  cb=$(curl -s -o /dev/null -m 6 -w "%{http_code}:%{size_download}" "https://logo.clearbit.com/$d")
  g=$(curl -s -o /dev/null -m 6 -w "%{http_code}:%{size_download}" "https://www.google.com/s2/favicons?domain=$d&sz=128")
  printf "%-22s %-8s %-10s %-8s %-10s\n" "$d" "${cb%%:*}" "${cb##*:}" "${g%%:*}" "${g##*:}"
done
