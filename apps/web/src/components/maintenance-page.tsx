import { AlertTriangle } from "lucide-react";

interface MaintenancePageProps {
	message?: string;
}

export function MaintenancePage({ message }: MaintenancePageProps) {
	return (
		<div className="min-h-screen flex items-center justify-center bg-background">
			<div className="text-center max-w-md mx-auto px-4">
				<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-yellow-100 dark:bg-yellow-900/30 mb-8">
					<AlertTriangle className="w-10 h-10 text-yellow-600 dark:text-yellow-500" />
				</div>
				<h1 className="text-3xl font-bold text-foreground mb-4">系统维护中</h1>
				<p className="text-muted-foreground text-lg mb-8">
					{message || "我们正在进行系统维护，请稍后再访问。"}
				</p>
				<div className="flex justify-center gap-1">
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							className="w-3 h-3 rounded-full bg-primary animate-bounce"
							style={{ animationDelay: `${i * 0.15}s` }}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
