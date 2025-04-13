import { supabase } from "../supabase";
import { GroupError } from "./groupService";
import { Task, GroupMember } from "@/types/dashboard";

/**
 * Error type for habit operations
 */
export class HabitError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HabitError";
  }
}

// Define types for the API responses
interface ProfileData {
  id?: number;
  display_name?: string;
}

interface MemberWithProfile {
  user_id: string;
  profiles: ProfileData | ProfileData[] | { display_name: any };
}

/**
 * Add a new habit task for the current user in their group
 */
export async function addHabitTask(
  taskName: string,
): Promise<{ success: boolean; id?: string; error?: HabitError | GroupError }> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user) {
      throw new HabitError("User not authenticated", "AUTH_ERROR");
    }

    const userId = userData.user.id;

    const { data: userProfileData, error: userProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    const userIdBigInt = userProfileData?.id;

    const { data: groupData, error: groupError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId);

    if (groupError || !groupData || groupData.length === 0) {
      throw new GroupError("No group found for user", "NO_GROUP");
    }

    const groupId = groupData[0].group_id;

    const { data: habitData, error: habitError } = await supabase
      .from("habits")
      .insert({
        group_id: groupId,
        user_id: userId,
        name: taskName.trim(),
        completed: false,
      })
      .select()
      .single();

    if (habitError || !habitData) {
      throw new HabitError("Failed to insert task", "TASK_INSERT_ERROR");
    }

    return { success: true, id: habitData.id };
  } catch (e) {
    if (e instanceof HabitError || e instanceof GroupError) {
      return { success: false, error: e };
    }

    console.error("Unexpected error inserting habit:", e);
    return {
      success: false,
      error: new HabitError("Unexpected error occurred", "UNKNOWN"),
    };
  }
}

export async function deleteHabitTask(
  taskId: string,
): Promise<{ success: boolean; error?: HabitError }> {
  try {
    console.log("attempting to delete task: ", taskId);
    const { data, error } = await supabase
      .from("habits")
      .delete()
      .eq("id", Number(taskId));
    if (error) {
      throw new HabitError("Failed to delete task", "TASK_DELETE_ERROR");
    }
    return { success: true };
  } catch (e) {
    if (e instanceof HabitError) {
      return { success: false, error: e };
    }
    console.error("unexpected error deleting habit", e);
    return {
      success: false,
      error: new HabitError("Unexpected error occured", "UNKNOWN"),
    };
  }
}

export async function getHabitTasks(): Promise<{
  members?: GroupMember[];
  error?: HabitError | GroupError;
}> {
  try {
    // Step 1: Get current user
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      throw new HabitError("User not authenticated", "AUTH_ERROR");
    }

    const currentUserId = userData.user.id;

    // Step 2: Find user's group_id
    const { data: groupRow, error: groupError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (groupError || !groupRow?.group_id) {
      throw new GroupError("User is not in a group", "NO_GROUP");
    }

    const groupId = groupRow.group_id;

    // Step 3: Get all members in the group (and their profiles)
    const { data: memberRows, error: memberError } = await supabase
      .from("group_members")
      .select("user_id, profiles(display_name)")
      .eq("group_id", groupId);
    if (memberError || !memberRows) {
      throw new GroupError(
        "Failed to fetch group members",
        "MEMBERS_FETCH_ERROR",
      );
    }

    console.log("fetching from: ", groupId);
    console.log(memberRows);
    // Step 4: Get all tasks in the group
    const { data: taskRows, error: taskError } = await supabase
      .from("habits")
      .select("id, name, user_id, completed")
      .eq("group_id", groupId);

    if (taskError || !taskRows) {
      throw new HabitError("Failed to fetch habit tasks", "TASK_FETCH_ERROR");
    }

    //get all profiles in a group
    const { data: profileRows, error: profileError } = await supabase
      .from("group_members")
      .select("user_id, profiles(id, display_name)")
      .eq("group_id", groupId);

    if (profileError || !profileRows) {
      throw new GroupError(
        "Failed to fetch group profiles ",
        "GROUP_FETCH_ERROR",
      );
    }

    // Step 5: Group tasks by user (synchronously)
    const members: GroupMember[] = memberRows.map((member: MemberWithProfile) => {
      console.log(member);
      const userId = member.user_id;
      let displayName = "Unknown";
      
      // Extract display name from profiles data which could have different structures
      if (member.profiles) {
        if (Array.isArray(member.profiles) && member.profiles.length > 0) {
          const profile = member.profiles[0] as ProfileData;
          displayName = profile.display_name || "Unknown";
        } 
        else if (typeof member.profiles === 'object') {
          // Handle direct object with display_name property
          const profile = member.profiles as ProfileData;
          displayName = profile.display_name || "Unknown";
        }
      }

      const name = userId === currentUserId ? "You" : displayName;
      const avatar = "https://placeholder.svg?height=50&width=50"; // Default avatar for all users

      const userTasks = taskRows.filter((task) => task.user_id === userId);
      const tasks: Task[] = userTasks.map((task) => ({
        id: task.id.toString(),
        title: task.name,
        completed: task.completed || false, // Provide a default value if completed is null
      }));

      return {
        id: userId,
        name,
        avatar,
        tasks,
        lastCheckin: "", // Replace this if you track activity
      };
    });

    return { members };
  } catch (e) {
    if (e instanceof HabitError || e instanceof GroupError) {
      return { error: e };
    }

    console.error("Unexpected error in getHabitTasks:", e);
    return {
      error: new HabitError("Unexpected error occurred", "UNKNOWN"),
    };
  }
}

export async function markHabitComplete(
  taskId: string
): Promise<{ success: boolean; error?: HabitError }> {
  try {
    // Update the habit directly to set completed status to true
    const { error: updateError } = await supabase
      .from("habits")
      .update({ completed: true })
      .eq("id", Number(taskId));

    if (updateError) {
      throw new HabitError("Failed to complete habit task", "TASK_UPDATE_ERROR");
    }

    return { success: true };
  } catch (e) {
    if (e instanceof HabitError) {
      return { success: false, error: e };
    }
    console.error("Unexpected error completing habit:", e);
    return {
      success: false,
      error: new HabitError("Unexpected error occurred", "UNKNOWN"),
    };
  }
}
