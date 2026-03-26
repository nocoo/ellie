#!/usr/bin/env bun
// Ellie CLI — Telnet-style command-line forum client
import { program } from "commander";

// TODO: Implement commands
// import { login } from "./commands/login";
// import { browseForum } from "./commands/browse";
// import { openThread } from "./commands/thread";
// import { postReply } from "./commands/reply";

program.name("ellie").description("Ellie Forum CLI").version("0.1.0");

// TODO: Add commands
// program.command("login").description("Login to Ellie").action(login);
// program.command("browse [forumId]").description("Browse forum").action(browseForum);
// program.command("thread <threadId>").description("Open thread").action(openThread);
// program.command("reply <threadId>").description("Post reply").action(postReply);

program.parse();
