export function Fail({ message }: { message: string }) {
  return (
    <p className="px-4 py-8 text-sm text-down sm:px-6 lg:px-8" role="alert">
      {message}
    </p>
  );
}

export function Quiet({ message }: { message: string }) {
  return <p className="px-4 py-8 text-sm text-muted sm:px-6 lg:px-8">{message}</p>;
}
