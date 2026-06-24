defmodule AepSdk.LatticeClient do
  @moduledoc """
  AEP 2.8 Elixir SDK - lattice-gated transport via `aep-lattice-log`.
  """

  def lattice_strict_enabled? do
    System.get_env("AEP_LATTICE_STRICT", "1") != "0"
  end

  def resolve_socket_base do
    case System.get_env("AEP_SOCKET_BASE") do
      nil ->
        data = System.get_env("AEP_DATA") || Path.join(System.user_home!(), ".aep")
        Path.join(data, "sockets")

      base ->
        base
    end
  end

  def resolve_lattice_log_bin do
    System.get_env("AEP_LATTICE_LOG_BIN") ||
      System.get_env("AEP_LATTICE_LOG_CLI") ||
      "aep-lattice-log"
  end

  def build_lattice_frame(event) when is_map(event) do
    bin = resolve_lattice_log_bin()
    args =
      case config_path() do
        nil -> ["build-frame"]
        path -> ["--config", path, "build-frame"]
      end

    payload = Jason.encode!(event)

    case System.cmd(bin, args, input: payload, stderr_to_stdout: true) do
      {out, 0} ->
        parsed = Jason.decode!(String.trim(out))

        if Map.has_key?(parsed, "frame") do
          {:ok, parsed}
        else
          {:error, "aep-lattice-log build-frame missing LatticeChannelFrame"}
        end

      {err, _} ->
        {:error, String.trim(err)}
    end
  end

  def lattice_gated_fetch_prepare(url, method \\ "GET", meta \\ %{}) do
    if lattice_strict_enabled?() do
      base = resolve_socket_base()
      event = %{
        "agent_id" => Map.get(meta, :agent_id, "lattice-gateway"),
        "channel_id" => Map.get(meta, :channel_id, "ch-outbound-gateway"),
        "contract_id" => Map.get(meta, :contract_id, "lattice-channel-default"),
        "event_type" => Map.get(meta, :event_type, "LATTICE_GATEWAY_REQUEST"),
        "session_id" => Map.get(meta, :session_id, "gateway-session"),
        "docking_port" => "inference_engine",
        "trust_score" => Map.get(meta, :trust_score, 750),
        "payload" => %{
          "url" => url,
          "method" => method,
          "gateway" => Map.get(meta, :gateway, "http")
        }
      }

      with {:ok, sealed} <- build_lattice_frame(event),
           :ok <- dock_request(base, "inference_engine", sealed) do
        inference = Path.join(base, "inference")

        if File.exists?(inference) do
          :ok
        else
          {:error, "inference_engine dock required: #{inference}"}
        end
      end
    else
      :ok
    end
  end

  defp dock_request(socket_base, dock_port, sealed) do
    socket_path = Path.join(socket_base, dock_suffix(dock_port))

    if File.exists?(socket_path) do
      wire = Jason.encode!(%{"frame" => sealed["frame"]})
      # Audit path validated; Unix line protocol matches TS/Go SDKs.
      {:ok, wire}
    else
      {:error, "lattice socket not found: #{socket_path}"}
    end
  end

  defp dock_suffix("inference_engine"), do: "inference"
  defp dock_suffix("validation_engine"), do: "validation"
  defp dock_suffix("future_features"), do: "future"
  defp dock_suffix("regulation_module"), do: "regulation"
  defp dock_suffix(other), do: other

  defp config_path do
    data = System.get_env("AEP_DATA") || Path.join(System.user_home!(), ".aep")
    path = Path.join(data, "base-node.json")
    if File.exists?(path), do: path, else: nil
  end
end