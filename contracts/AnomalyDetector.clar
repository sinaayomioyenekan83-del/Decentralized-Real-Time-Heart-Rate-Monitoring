(define-constant ERR_NOT_AUTHORIZED (err u300))
(define-constant ERR_INVALID_DEVICE (err u301))
(define-constant ERR_NO_DATA (err u302))
(define-constant ERR_INVALID_THRESHOLD (err u303))
(define-constant ERR_CONTRACT_PAUSED (err u304))
(define-constant ERR_ALREADY_PAUSED (err u305))
(define-constant ERR_NOT_PAUSED (err u306))
(define-constant ERR_INVALID_PAUSE_DURATION (err u307))
(define-constant ERR_INVALID_ALERT_TYPE (err u308))
(define-constant ERR_NO_PERMISSION (err u309))
(define-constant ERR_INVALID_RATE_RANGE (err u310))
(define-constant ERR_INVALID_TIME_WINDOW (err u311))
(define-constant ERR_MAX_ALERTS_EXCEEDED (err u312))
(define-constant ERR_INVALID_RECIPIENT (err u313))
(define-constant ERR_NO_ANOMALY (err u314))

(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var pause-end-time uint u0)
(define-data-var max-alerts-per-device uint u50)
(define-data-var anomaly-time-window uint u300)
(define-data-var min-heart-rate-threshold uint u40)
(define-data-var max-heart-rate-threshold uint u180)

(define-map Alerts { device-id: principal, timestamp: uint } { heart-rate: uint, alert-type: (string-utf8 20), recipient: principal })
(define-map AlertRecipients principal (list 50 principal))
(define-map AnomalyThresholds principal { min-rate: uint, max-rate: uint })

(define-trait data-oracle
  ((get-latest-heart-rate (principal) (response (optional { heart-rate: uint, timestamp: uint, oracle: principal }) uint))
   (get-heart-rate-history (principal) (response (optional (list 100 { heart-rate: uint, timestamp: uint })) uint))))

(define-trait access-control
  ((check-access (principal principal) (response (string-utf8 20) uint))))

(define-read-only (get-alert (device-id principal) (timestamp uint))
  (map-get? Alerts { device-id: device-id, timestamp: timestamp })
)

(define-read-only (get-anomaly-thresholds (device-id principal))
  (map-get? AnomalyThresholds device-id)
)

(define-read-only (get-alert-recipients (device-id principal))
  (map-get? AlertRecipients device-id)
)

(define-read-only (is-contract-paused)
  (var-get is-paused)
)

(define-private (validate-alert-type (alert-type (string-utf8 20)))
  (if (or (is-eq alert-type u"high") (is-eq alert-type u"low") (is-eq alert-type u"irregular"))
      (ok true)
      (err ERR_INVALID_ALERT_TYPE))
)

(define-private (validate-thresholds (min-rate uint) (max-rate uint))
  (if (< min-rate max-rate)
      (ok true)
      (err ERR_INVALID_RATE_RANGE))
)

(define-private (detect-anomaly (heart-rate uint) (min-rate uint) (max-rate uint))
  (if (or (< heart-rate min-rate) (> heart-rate max-rate))
      (ok (if (< heart-rate min-rate) u"low" u"high"))
      (err ERR_NO_ANOMALY))
)

(define-public (set-anomaly-thresholds (device-id principal) (min-rate uint) (max-rate uint) (oracle-contract <data-oracle>))
  (begin
    (asserts! (not (var-get is-paused)) ERR_CONTRACT_PAUSED)
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (try! (contract-call? oracle-contract get-latest-heart-rate device-id))
    (try! (validate-thresholds min-rate max-rate))
    (map-set AnomalyThresholds device-id { min-rate: min-rate, max-rate: max-rate })
    (ok true)
  )
)

(define-public (add-alert-recipient (device-id principal) (recipient principal) (access-control-contract <access-control>))
  (begin
    (asserts! (not (var-get is-paused)) ERR_CONTRACT_PAUSED)
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (try! (contract-call? access-control-contract check-access device-id recipient))
    (let ((recipients (default-to (list) (map-get? AlertRecipients device-id))))
      (asserts! (< (len recipients) (var-get max-alerts-per-device)) ERR_MAX_ALERTS_EXCEEDED)
      (map-set AlertRecipients device-id (append recipients recipient))
      (ok true)
    )
  )
)

(define-public (process-data (device-id principal) (heart-rate uint) (timestamp uint) (oracle-contract <data-oracle>) (access-control-contract <access-control>))
  (begin
    (asserts! (not (var-get is-paused)) ERR_CONTRACT_PAUSED)
    (match (map-get? AnomalyThresholds device-id)
      thresholds
        (let ((min-rate (get min-rate thresholds)) (max-rate (get max-rate thresholds)))
          (match (detect-anomaly heart-rate min-rate max-rate)
            alert-type
              (begin
                (try! (validate-alert-type alert-type))
                (fold send-alert (default-to (list) (map-get? AlertRecipients device-id)) (ok { device: device-id, heart-rate: heart-rate, alert-type: alert-type, timestamp: timestamp }))
              )
            (err ERR_NO_ANOMALY)
          )
        )
      (err ERR_INVALID_THRESHOLD)
    )
  )
)

(define-private (send-alert (recipient principal) (result (response { device: principal, heart-rate: uint, alert-type: (string-utf8 20), timestamp: uint } uint)))
  (match result
    data
      (begin
        (try! (contract-call? .access-control check-access (get device data) recipient))
        (map-set Alerts { device-id: (get device data), timestamp: (get timestamp data) }
          { heart-rate: (get heart-rate data), alert-type: (get alert-type data), recipient: recipient })
        (print { event: "alert-triggered", device: (get device data), heart-rate: (get heart-rate data), alert-type: (get alert-type data), recipient: recipient })
        (ok data)
      )
    error (err error)
  )
)

(define-public (pause-contract (duration uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (asserts! (not (var-get is-paused)) ERR_ALREADY_PAUSED)
    (asserts! (> duration u0) ERR_INVALID_PAUSE_DURATION)
    (var-set is-paused true)
    (var-set pause-end-time (+ block-height duration))
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (asserts! (var-get is-paused) ERR_NOT_PAUSED)
    (var-set is-paused false)
    (var-set pause-end-time u0)
    (ok true)
  )
)

(define-public (set-anomaly-time-window (new-window uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (asserts! (> new-window u0) ERR_INVALID_TIME_WINDOW)
    (var-set anomaly-time-window new-window)
    (ok true)
  )
)

(define-public (set-max-alerts (new-max uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_AUTHORIZED)
    (asserts! (> new-max u0) ERR_MAX_ALERTS_EXCEEDED)
    (var-set max-alerts-per-device new-max)
    (ok true)
  )
)