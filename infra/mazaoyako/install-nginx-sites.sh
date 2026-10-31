#!/usr/bin/env bash
set -euo pipefail
umask 077
CONFIG_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
AVAILABLE=/etc/nginx/sites-available
ENABLED=/etc/nginx/sites-enabled
WEBROOT=/var/www/mazaoyako/acme

sudo -n install -d -o root -g root -m 755 "$AVAILABLE" "$ENABLED"
sudo -n install -d -o www-data -g www-data -m 755 "$WEBROOT"

install_bootstrap_or_final() {
  local bootstrap=$1 final=$2 destination=$3 temporary
  if sudo -n test -L "$destination"; then
    echo "Refusing to replace an unexpected Nginx site symlink: $destination" >&2
    exit 1
  elif sudo -n test -e "$destination"; then
    if ! sudo -n cmp -s "$bootstrap" "$destination" && ! sudo -n cmp -s "$final" "$destination"; then
      echo "Refusing to replace an unrelated Nginx site file: $destination" >&2
      exit 1
    fi
  else
    temporary="$destination.mazaoyako-new"
    if sudo -n test -e "$temporary" || sudo -n test -L "$temporary"; then
      echo "Refusing to replace an existing Nginx staging path: $temporary" >&2
      exit 1
    fi
    sudo -n install -o root -g root -m 644 "$bootstrap" "$temporary"
    sudo -n mv -T "$temporary" "$destination"
  fi
}

enable_exact_or_create() {
  local target=$1 link=$2 existing
  if sudo -n test -L "$link"; then
    existing=$(sudo -n readlink -f "$link")
    [[ "$existing" == "$target" ]] || { echo "Refusing to change unrelated enabled site: $link" >&2; exit 1; }
  elif sudo -n test -e "$link"; then
    echo "Refusing to replace unrelated enabled site path: $link" >&2
    exit 1
  else
    sudo -n ln -s "$target" "$link"
  fi
}

install_bootstrap_or_final "$CONFIG_DIR/nginx-bootstrap-frontend.conf" "$CONFIG_DIR/nginx-frontend.conf" "$AVAILABLE/mazaoyako"
install_bootstrap_or_final "$CONFIG_DIR/nginx-bootstrap-api.conf" "$CONFIG_DIR/nginx-api.conf" "$AVAILABLE/api.mazaoyako.co.ke"
enable_exact_or_create "$AVAILABLE/mazaoyako" "$ENABLED/mazaoyako"
enable_exact_or_create "$AVAILABLE/api.mazaoyako.co.ke" "$ENABLED/api.mazaoyako.co.ke"
sudo -n nginx -t
sudo -n systemctl reload nginx

if ! sudo -n test -s /etc/letsencrypt/live/mazaoyako.co.ke/fullchain.pem; then
  sudo -n certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --no-eff-email \
    --webroot --webroot-path "$WEBROOT" --cert-name mazaoyako.co.ke -d mazaoyako.co.ke
fi
if ! sudo -n test -s /etc/letsencrypt/live/api.mazaoyako.co.ke/fullchain.pem; then
  sudo -n certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --no-eff-email \
    --webroot --webroot-path "$WEBROOT" --cert-name api.mazaoyako.co.ke -d api.mazaoyako.co.ke
fi

# Replace only these two task-owned bootstrap blocks, after both certificates exist.
for pair in \
  "$CONFIG_DIR/nginx-bootstrap-frontend.conf|$CONFIG_DIR/nginx-frontend.conf|$AVAILABLE/mazaoyako" \
  "$CONFIG_DIR/nginx-bootstrap-api.conf|$CONFIG_DIR/nginx-api.conf|$AVAILABLE/api.mazaoyako.co.ke"; do
  IFS='|' read -r bootstrap final destination <<< "$pair"
  if sudo -n cmp -s "$bootstrap" "$destination"; then
    temporary="$destination.mazaoyako-new"
    if sudo -n test -e "$temporary" || sudo -n test -L "$temporary"; then
      echo "Refusing to replace an existing Nginx staging path: $temporary" >&2
      exit 1
    fi
    sudo -n install -o root -g root -m 644 "$final" "$temporary"
    sudo -n mv -T "$temporary" "$destination"
  elif ! sudo -n cmp -s "$final" "$destination"; then
    echo "Refusing to replace a changed Nginx site block: $destination" >&2
    exit 1
  fi
done

sudo -n nginx -t
sudo -n systemctl reload nginx
printf '%s\n' 'Mazao Yako Nginx sites and certificates are installed.'
