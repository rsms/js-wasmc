#include <emscripten/emscripten.h>
#include <stdio.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE

// This is an external JS function defined in lib.js
extern void fun_from_js(int a, int b);

// A simple "hello world" function
EXPORT void hello() {
  printf("Hello from wasm on stdout\n");
  fprintf(stderr, "Hello from wasm on stderr\n");
  fun_from_js(10, 20);
}

// Function that receives a pointer to some function and calls it.
EXPORT void callJsFunction(int(*f)(int,int)) {
  printf("WASM is calling JS function\n");
  int r = f(2, 3);
  printf("WASM got return value from JS function: %d\n", r);
}
