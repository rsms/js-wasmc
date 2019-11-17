#include <emscripten/emscripten.h>
#include <stdio.h>

void EMSCRIPTEN_KEEPALIVE hello() {
  printf("Hello from wasm\n");
}
