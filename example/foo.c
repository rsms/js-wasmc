#include <emscripten/emscripten.h>

void EMSCRIPTEN_KEEPALIVE hello() {
  printf("Hello from wasm\n");
}
