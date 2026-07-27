(ns aep-sdk.lattice-client
  (:require [cheshire.core :as json]
            [clojure.java.shell :as shell]
            [clojure.string :as str]))

(defn lattice-strict-enabled? []
  (not= "0" (System/getenv "AEP_LATTICE_STRICT")))

(defn resolve-socket-base []
  (if-let [base (System/getenv "AEP_SOCKET_BASE")]
    base
    (let [data (or (System/getenv "AEP_DATA")
                   (str (System/getProperty "user.home") "/.aep"))]
      (str data "/sockets"))))

(defn resolve-lattice-log-bin []
  (or (System/getenv "AEP_LATTICE_LOG_BIN")
      (System/getenv "AEP_LATTICE_LOG_CLI")
      "aep-lattice-log"))

(defn build-lattice-frame [event]
  (let [bin (resolve-lattice-log-bin)
        args (cond-> ["build-frame"]
               (let [data (or (System/getenv "AEP_DATA")
                              (str (System/getProperty "user.home") "/.aep"))
                     cfg (str data "/base-node.json")]
                 (.exists (java.io.File. cfg)))
               (conj "--config" (str (or (System/getenv "AEP_DATA")
                                         (str (System/getProperty "user.home") "/.aep"))
                                     "/base-node.json")))
        payload (json/generate-string event)
        result (shell/sh bin :in payload :args args)]
    (when (pos? (:exit result))
      (throw (ex-info "aep-lattice-log build-frame failed" {:err (:err result)})))
    (let [parsed (json/parse-string (:out result) true)]
      (when-not (:frame parsed)
        (throw (ex-info "missing LatticeChannelFrame" {:out (:out result)})))
      parsed)))

(defn lattice-gated-fetch-prepare
  [url method & [{:keys [agent-id channel-id contract-id event-type session-id trust-score gateway]
                  :or {agent-id "lattice-gateway"
                       channel-id "ch-outbound-gateway"
                       contract-id "lattice-channel-default"
                       event-type "LATTICE_GATEWAY_REQUEST"
                       session-id "gateway-session"
                       trust-score 750
                       gateway "http"}}]]
  (when (lattice-strict-enabled?)
    (let [base (resolve-socket-base)
          event {:agent_id agent-id
                 :channel_id channel-id
                 :contract_id contract-id
                 :event_type event-type
                 :session_id session-id
                 :docking_port "inference_engine"
                 :trust_score trust-score
                 :payload {:url url :method method :gateway gateway}}
          _ (build-lattice-frame event)
          inference (str base "/inference")]
      (when-not (.exists (java.io.File. inference))
        (throw (ex-info "inference_engine dock required" {:path inference}))))))

(defn smoke []
  (try
    (build-lattice-frame {:agent_id "sdk-smoke"
                          :channel_id "ch-smoke"
                          :event_type "SDK_SMOKE"
                          :payload {}})
    (println "ok")
    (catch Exception e
      (println "skip:" (.getMessage e)))))