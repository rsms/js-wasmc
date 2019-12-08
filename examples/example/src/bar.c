#include <stdio.h>

export void bar_hello() {
  fprintf(stderr, "Hello from wasm on stderr\n");
}
