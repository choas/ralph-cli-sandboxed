#!/bin/bash
# Firewall initialization script for Ralph sandbox
# Based on Claude Code devcontainer firewall

set -e

echo "Initializing sandbox firewall..."

# Get Docker DNS before flushing
DOCKER_DNS=$(cat /etc/resolv.conf | grep nameserver | head -1 | awk '{print $2}')

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# Create ipset for allowed IPs
ipset destroy allowed_ips 2>/dev/null || true
ipset create allowed_ips hash:net

# Allow localhost
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
if [ -n "$DOCKER_DNS" ]; then
    iptables -A OUTPUT -d $DOCKER_DNS -j ACCEPT
fi

# Allow SSH (for git)
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# Add allowed domains to ipset
# GitHub
for ip in $(dig +short github.com api.github.com raw.githubusercontent.com); do
    ipset add allowed_ips $ip 2>/dev/null || true
done

# npm registry
for ip in $(dig +short registry.npmjs.org); do
    ipset add allowed_ips $ip 2>/dev/null || true
done

# Anthropic API
for ip in $(dig +short api.anthropic.com); do
    ipset add allowed_ips $ip 2>/dev/null || true
done

# Allow host network (for mounted volumes, etc.)
HOST_NETWORK=$(ip route | grep default | awk '{print $3}' | head -1)
if [ -n "$HOST_NETWORK" ]; then
    HOST_SUBNET=$(echo $HOST_NETWORK | sed 's/\.[0-9]*$/.0\/24/')
    ipset add allowed_ips $HOST_SUBNET 2>/dev/null || true
fi

# Allow traffic to allowed IPs
iptables -A OUTPUT -m set --match-set allowed_ips dst -j ACCEPT

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow HTTPS to allowed IPs
iptables -I OUTPUT -p tcp --dport 443 -m set --match-set allowed_ips dst -j ACCEPT
iptables -I OUTPUT -p tcp --dport 80 -m set --match-set allowed_ips dst -j ACCEPT

echo "Firewall initialized. Only allowed destinations are accessible."
echo "Allowed: GitHub, npm, Anthropic API, local network"
