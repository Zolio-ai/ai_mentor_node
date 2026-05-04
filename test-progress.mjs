import mongoose from "mongoose";
import { getOrCreateTaskFlows } from "./src/services/taskService.mjs";

async function test() {
  await mongoose.connect("mongodb://localhost:27017/ai_mentor_app");
  try {
    const flows = await getOrCreateTaskFlows("69f1b180ae68eb74a862331e");
    console.log(JSON.stringify(flows, null, 2));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
test();
