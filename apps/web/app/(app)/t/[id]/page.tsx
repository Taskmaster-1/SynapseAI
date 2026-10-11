import { TaskView } from "@/components/task/task-view";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TaskView key={id} taskId={id} />;
}
