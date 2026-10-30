#!/usr/bin/env bash
# Compila o llama-server (llama.cpp) estático e copia para src-tauri/binaries com os nomes que o Tauri espera no externalBin.
set -euo pipefail
LLAMA_TAG=b12017 # release do llama.cpp de 30/10/2026; para atualizar, troque o tag e o commit (o cache do CI usa o hash deste arquivo)
LLAMA_SHA=5047748f114564fcf271e6a648f60e2d2eae6264 # commit do tag: tag pode ser movido, commit não (como as actions)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
if [ "$(cat "$OUT/.tag" 2>/dev/null)" = "$LLAMA_TAG" ]; then echo "llama-server $LLAMA_TAG já compilado"; exit 0; fi
SRC="${TMPDIR:-/tmp}/llama.cpp-$LLAMA_TAG"
if [ ! -d "$SRC" ]; then
  git init -q "$SRC" && git -C "$SRC" fetch -q --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_SHA" && git -C "$SRC" checkout -q FETCH_HEAD
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$LLAMA_SHA" ] || { echo "llama.cpp em $SRC não é o commit $LLAMA_SHA" >&2; exit 1; }
mkdir -p "$OUT"
# sem OpenSSL (o servidor só fala HTTP em 127.0.0.1 e no Mac de quem instala não há Homebrew) e sem a interface web (baixada da rede no build)
COMMON=(-DBUILD_SHARED_LIBS=OFF -DLLAMA_OPENSSL=OFF -DGGML_NATIVE=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DCMAKE_BUILD_TYPE=Release)
build() { cmake -S "$SRC" -B "$SRC/build-$1" "${COMMON[@]}" "${@:2}" && cmake --build "$SRC/build-$1" --config Release --target llama-server -j 8; }
case "$(uname -s)" in
  Darwin)
    build metal -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DCMAKE_OSX_ARCHITECTURES=arm64
    BIN="$SRC/build-metal/bin/llama-server"
    if otool -L "$BIN" | tail -n +2 | grep -vE '^[[:space:]]+(/usr/lib/|/System/)'; then echo "llama-server depende de biblioteca fora do sistema (acima)" >&2; exit 1; fi
    # shortcut: só arm64; Mac Intel fica "indisponível" no Assistente e nunca sobe o servidor. Fazer lipo se o Intel entrar.
    for t in aarch64 x86_64 universal; do cp "$BIN" "$OUT/llama-server-$t-apple-darwin"; done ;;
  MINGW*|MSYS*|CYGWIN*)
    # CRT estático: não depende do Visual C++ Redistributable na máquina de quem instala
    build vulkan -DGGML_VULKAN=ON -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
    build cpu -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
    cp "$SRC/build-vulkan/bin/Release/llama-server.exe" "$OUT/llama-server-x86_64-pc-windows-msvc.exe"
    cp "$SRC/build-cpu/bin/Release/llama-server.exe" "$OUT/llama-server-cpu-x86_64-pc-windows-msvc.exe" ;;
  *) echo "Sistema sem suporte: $(uname -s)" >&2; exit 1 ;;
esac
echo "$LLAMA_TAG" > "$OUT/.tag"
