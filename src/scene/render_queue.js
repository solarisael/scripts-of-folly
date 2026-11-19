// One in-flight render consumes current state; repeated requests coalesce.
export function create_render_queue(draw, { report, on_error }) {
  let pending = null;
  let requested = false;
  let report_requested = false;
  let disposed = false;
  const drain = async () => {
    try {
      while (requested && !disposed) {
        requested = false;
        const show_report = report_requested;
        report_requested = false;
        await draw();
        if (show_report && !disposed) report();
      }
      return !disposed;
    } catch (error) {
      disposed = true;
      on_error(error);
      return false;
    } finally {
      pending = null;
    }
  };
  const request = (show_report = true) => {
    if (disposed) return Promise.resolve(false);
    requested = true;
    report_requested ||= show_report;
    pending ??= Promise.resolve().then(drain);
    return pending;
  };
  request.dispose = () => {
    disposed = true;
    requested = false;
  };
  return request;
}
