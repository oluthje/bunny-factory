# Sourced by bunny-stack and, through /etc/profile.d, by login shells (the agent's included).
# When a sandbox has Daytona Secrets, Daytona routes HTTPS through its egress proxy
# (HTTPS_PROXY etc.) and sets no NO_PROXY. Local bunny traffic must skip that proxy, or curl,
# Node and Chromium send https://bunny.bunny.internal out to Daytona instead of to Caddy.
# Both suffix forms: curl and Ruby read ".bunny.internal", Chromium also reads "*.bunny.internal".
case ",${NO_PROXY:-}," in
  *",.bunny.internal,"*) ;;
  *) export NO_PROXY="${NO_PROXY:+$NO_PROXY,}localhost,127.0.0.1,::1,bunny.internal,.bunny.internal,*.bunny.internal"
     export no_proxy="$NO_PROXY" ;;
esac
