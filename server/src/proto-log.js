// Test Worker for one merge approach; built only to measure its bundle size.
import * as M from "../proto/log.mjs";
import { runCase } from "./proto.js";
export default { fetch() { return Response.json(runCase(M)); } };
