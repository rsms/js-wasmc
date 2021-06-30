import { hello } from "./foo" // cyclic on purpose, for testing
import "./bar2"

export function call_bar() {
  _bar_hello() // outputs a message on stderr
}
