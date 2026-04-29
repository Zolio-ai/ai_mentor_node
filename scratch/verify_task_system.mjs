import mongoose from "mongoose";
import dotenv from "dotenv";
import { Task, StudyPlan, User, TaskFlow } from "../src/models/index.mjs";
import { 
  initializeTasksFromStudyPlan, 
  initializeTaskFlowForNewUser
} from "../src/services/taskService.mjs";

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || "ai_mentor_app";

async function verify() {
  try {
    await mongoose.connect(mongoUri, { dbName: mongoDbName });
    console.log("Connected to MongoDB");

    // 1. Create a test student (already onboarded)
    const existingStudent = await User.create({
      name: "Existing Student",
      email: `existing_${Date.now()}@example.com`,
      onboardingCompleted: true
    });
    console.log("Created existing test student");

    // 2. Create a test study plan (should trigger TaskFlow for existing students)
    const studyPlan = await StudyPlan.create({
      planName: "Automation Test Plan",
      weeks: [
        {
          weekNumber: 1,
          title: "Week 1",
          topics: ["Auto Topic A", "Auto Topic B"]
        }
      ]
    });
    console.log("Created test study plan");

    // 3. Initialize tasks (this now also initializes TaskFlow for existing users)
    console.log("Initializing tasks and taskflows for existing users...");
    await initializeTasksFromStudyPlan(studyPlan);

    // 4. Verify TaskFlow for existing student
    const existingFlows = await TaskFlow.find({ studentId: existingStudent._id });
    console.log(`Found ${existingFlows.length} TaskFlow entries for existing student`);
    if (existingFlows.length === 2) {
      console.log("SUCCESS: TaskFlows created for existing student during plan initialization");
    } else {
      console.log("FAILURE: TaskFlows not created for existing student");
    }

    // 5. Create a new student (should trigger TaskFlow for existing tasks)
    const newStudent = await User.create({
      name: "New Student",
      email: `new_${Date.now()}@example.com`,
      onboardingCompleted: true
    });
    console.log("Created new test student");
    
    console.log("Initializing TaskFlow for new student...");
    await initializeTaskFlowForNewUser(newStudent._id);

    // 6. Verify TaskFlow for new student
    const newFlows = await TaskFlow.find({ studentId: newStudent._id });
    console.log(`Found ${newFlows.length} TaskFlow entries for new student`);
    if (newFlows.length >= 2) {
      console.log("SUCCESS: TaskFlows created for new student upon registration");
    } else {
      console.log("FAILURE: TaskFlows not created for new student");
    }

    // Cleanup
    await TaskFlow.deleteMany({ studentId: { $in: [existingStudent._id, newStudent._id] } });
    await Task.deleteMany({ studyPlanId: studyPlan._id });
    await StudyPlan.deleteOne({ _id: studyPlan._id });
    await User.deleteMany({ _id: { $in: [existingStudent._id, newStudent._id] } });
    console.log("Cleanup completed");

  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

verify();
