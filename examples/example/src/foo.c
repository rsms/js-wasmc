#include <emscripten/emscripten.h>
#define export EMSCRIPTEN_KEEPALIVE
#include <stdio.h>

export void foo_hello() {
  printf("Hello from wasm on stdout\n");
}
