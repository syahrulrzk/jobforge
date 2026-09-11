#!/bin/bash
# Follow redirects; test Google s2 + DDG + direct favicon for candidates
DOMAINS="tokopedia.com bukalapak.com shopee.co.id blibli.com lazada.co.id gojek.com traveloka.com tiket.com grab.com ruangguru.com zenius.net halodoc.com alodokter.com dana.id ovo.id kredivo.com midtrans.com stockbit.com ajaib.co.id jtexpress.id sicepat.com anteraja.id ninjavan.co telkomsel.com xl.co.id detik.com kompas.com kumparan.com idntimes.com glints.com efishery.com agate.id pasarpolis.com sayurbox.com kalibrr.com"

printf "%-20s %-10s %-11s %-10s %-10s\n" "DOMAIN" "GOOG" "GOOG_B" "DDG" "DDG_B"
for d in $DOMAINS; do
  g=$(curl -sL -o /dev/null -m 8 -w "%{http_code}:%{size_download}:%{content_type}" "https://www.google.com/s2/favicons?domain=$d&sz=128")
  dd=$(curl -sL -o /dev/null -m 8 -w "%{http_code}:%{size_download}:%{content_type}" "https://icons.duckduckgo.com/ip3/$d.ico")
  printf "%-20s %-10s %-11s %-10s %-10s\n" "$d" "${g%%:*}" "$(echo $g | cut -d: -f2)" "${dd%%:*}" "$(echo $dd | cut -d: -f2)"
done
