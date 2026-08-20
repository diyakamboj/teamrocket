import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Each test gets a clean document; a leaked tree makes the next test's
// queries match the previous test's markup.
afterEach(cleanup);
