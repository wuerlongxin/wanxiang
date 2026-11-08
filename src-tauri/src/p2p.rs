use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{
    Engine as _,
    engine::general_purpose::{
        STANDARD as BASE64_PADDED, STANDARD_NO_PAD as BASE64, URL_SAFE_NO_PAD,
    },
};
use futures_util::{
    StreamExt,
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
};
use libp2p::{
    Multiaddr, PeerId, StreamProtocol, Swarm, SwarmBuilder, identify, identity, mdns, ping,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tauri::{Manager, State};
use tokio::sync::{Mutex, RwLock, mpsc, oneshot};
use uuid::Uuid;

use crate::{
    builtin_artwork::is_builtin_card_artwork_path, error::CommandError, safety::assess_youth_safety,
};

const EXCHANGE_PROTOCOL: &str = "/wanxiang-deck/exchange/1";
const IDENTIFY_PROTOCOL: &str = "/wanxiang-deck/id/1.0.0";
const SIGNATURE_DOMAIN: &[u8] = b"wanxiang-deck/signed-deck/v1\0";
const MAX_DECK_BYTES: usize = 24 * 1024 * 1024;
const MAX_WIRE_BYTES: usize = 25 * 1024 * 1024;
const MAX_WIRE_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_CARDS: usize = 64;
const MAX_OFFERS: usize = 8;
const MAX_PENDING_INCOMING_OFFERS_PER_PEER: usize = 2;
const MAX_OFFER_HISTORY_BYTES: usize = 48 * 1024 * 1024;
const MAX_OFFER_JOURNAL_BYTES: usize = 50 * 1024 * 1024;
const OFFER_JOURNAL_SCHEMA_VERSION: u32 = 1;
const OFFER_JOURNAL_FILE_NAME: &str = "exchange-journal.json";
const MAX_CONNECTION_CODE_BYTES: usize = 4096;
const MAX_DISPLAY_NAME_CHARS: usize = 48;
const MAX_ART_BYTES: usize = 4 * 1024 * 1024;
const MAX_DECK_REVISION: u64 = 1_000_000;
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pSnapshot {
    running: bool,
    identity: Option<P2pIdentity>,
    peers: Vec<P2pPeer>,
    offers: Vec<ExchangeOffer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pStartResult {
    snapshot: P2pSnapshot,
    lease_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct P2pIdentity {
    peer_id: String,
    display_name: String,
    connection_code: String,
    listen_addresses: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct P2pPeer {
    peer_id: String,
    display_name: String,
    address: String,
    connected: bool,
    nearby: bool,
    verified: bool,
    last_seen: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeOffer {
    id: String,
    direction: OfferDirection,
    status: OfferStatus,
    peer_id: String,
    peer_name: String,
    deck: Arc<Value>,
    cid: String,
    signature_valid: bool,
    created_at: u64,
    #[serde(skip)]
    deck_bytes: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OfferDirection {
    Incoming,
    Outgoing,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OfferStatus {
    Pending,
    Accepted,
    Declined,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OfferJournal {
    schema_version: u32,
    local_peer_id: String,
    offers: Vec<PersistedExchangeOffer>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedExchangeOffer {
    id: String,
    direction: OfferDirection,
    status: OfferStatus,
    peer_id: String,
    peer_name: String,
    deck: Value,
    cid: String,
    signature_valid: bool,
    created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum WireRequest {
    Offer(SignedOffer),
    Decision(SignedDecision),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SignedOffer {
    offer_id: String,
    sender_name: String,
    deck: SignedDeck,
    created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SignedDecision {
    offer_id: String,
    sender_name: String,
    accept: bool,
    counter_deck: Option<SignedDeck>,
    created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SignedDeck {
    cid: String,
    signer_peer_id: String,
    public_key: String,
    signature: String,
    deck: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WireResponse {
    ok: bool,
    error: Option<String>,
}

#[derive(Clone, Default)]
struct WireCodec;

#[async_trait::async_trait]
impl request_response::Codec for WireCodec {
    type Protocol = StreamProtocol;
    type Request = WireRequest;
    type Response = WireResponse;

    async fn read_request<T>(&mut self, _: &Self::Protocol, io: &mut T) -> io::Result<Self::Request>
    where
        T: AsyncRead + Unpin + Send,
    {
        read_json_message(io, MAX_WIRE_BYTES).await
    }

    async fn read_response<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
    ) -> io::Result<Self::Response>
    where
        T: AsyncRead + Unpin + Send,
    {
        read_json_message(io, MAX_WIRE_RESPONSE_BYTES).await
    }

    async fn write_request<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
        request: Self::Request,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        write_json_message(io, &request, MAX_WIRE_BYTES).await
    }

    async fn write_response<T>(
        &mut self,
        _: &Self::Protocol,
        io: &mut T,
        response: Self::Response,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        write_json_message(io, &response, MAX_WIRE_RESPONSE_BYTES).await
    }
}

#[derive(NetworkBehaviour)]
#[behaviour(to_swarm = "BehaviourEvent")]
struct Behaviour {
    exchange: request_response::Behaviour<WireCodec>,
    mdns: mdns::tokio::Behaviour,
    identify: identify::Behaviour,
    ping: ping::Behaviour,
}

#[derive(Debug)]
enum BehaviourEvent {
    Exchange(request_response::Event<WireRequest, WireResponse>),
    Mdns(mdns::Event),
    Identify(identify::Event),
    Ping(ping::Event),
}

impl From<request_response::Event<WireRequest, WireResponse>> for BehaviourEvent {
    fn from(event: request_response::Event<WireRequest, WireResponse>) -> Self {
        Self::Exchange(event)
    }
}

impl From<mdns::Event> for BehaviourEvent {
    fn from(event: mdns::Event) -> Self {
        Self::Mdns(event)
    }
}

impl From<identify::Event> for BehaviourEvent {
    fn from(event: identify::Event) -> Self {
        Self::Identify(event)
    }
}

impl From<ping::Event> for BehaviourEvent {
    fn from(event: ping::Event) -> Self {
        Self::Ping(event)
    }
}

#[derive(Default)]
pub struct P2pState {
    node: Mutex<Option<NodeHandle>>,
    stopped_snapshot: RwLock<P2pSnapshot>,
}

struct NodeHandle {
    commands: mpsc::Sender<NodeCommand>,
    snapshot: Arc<RwLock<P2pSnapshot>>,
    task: tokio::task::JoinHandle<()>,
    lease_id: Uuid,
}

enum NodeCommand {
    Stop,
    Connect {
        connection_code: String,
        reply: oneshot::Sender<Result<(), CommandError>>,
    },
    SendOffer {
        peer_id: PeerId,
        deck: Value,
        reply: oneshot::Sender<Result<String, CommandError>>,
    },
    RespondOffer {
        offer_id: String,
        accept: bool,
        counter_deck: Option<Value>,
        reply: oneshot::Sender<Result<(), CommandError>>,
    },
}

enum PendingOperation {
    Offer {
        offer_id: String,
        reply: oneshot::Sender<Result<String, CommandError>>,
    },
    Decision {
        offer_id: String,
        accept: bool,
        reply: oneshot::Sender<Result<(), CommandError>>,
    },
}

struct NodeRuntime {
    swarm: Swarm<Behaviour>,
    keypair: identity::Keypair,
    local_peer_id: PeerId,
    display_name: String,
    snapshot: Arc<RwLock<P2pSnapshot>>,
    peers: HashMap<PeerId, P2pPeer>,
    offers: Vec<ExchangeOffer>,
    offer_journal_path: PathBuf,
    listen_addresses: HashSet<Multiaddr>,
    pending: HashMap<request_response::OutboundRequestId, PendingOperation>,
}

#[tauri::command]
pub async fn p2p_start(
    display_name: String,
    app: tauri::AppHandle,
    state: State<'_, P2pState>,
) -> Result<P2pStartResult, CommandError> {
    let display_name = sanitize_display_name(&display_name)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| p2p_error("P2P_STORAGE_UNAVAILABLE", "无法访问本机身份存储目录。"))?;
    start_p2p_at(&state, app_data_dir, display_name).await
}

#[tauri::command]
pub async fn p2p_stop(
    lease_id: Option<String>,
    state: State<'_, P2pState>,
) -> Result<P2pSnapshot, CommandError> {
    stop_p2p_state(&state, parse_lease_id(lease_id)?).await
}

#[tauri::command]
pub async fn p2p_snapshot(state: State<'_, P2pState>) -> Result<P2pSnapshot, CommandError> {
    let snapshot = {
        let node = state.node.lock().await;
        node.as_ref().map(|handle| Arc::clone(&handle.snapshot))
    };
    match snapshot {
        Some(snapshot) => Ok(snapshot.read().await.clone()),
        None => Ok(state.stopped_snapshot.read().await.clone()),
    }
}

async fn start_p2p_at(
    state: &P2pState,
    app_data_dir: PathBuf,
    display_name: String,
) -> Result<P2pStartResult, CommandError> {
    let mut node = state.node.lock().await;
    if let Some(existing) = node.as_ref() {
        let snapshot = existing.snapshot.read().await.clone();
        if snapshot.running {
            return Ok(P2pStartResult {
                snapshot,
                lease_id: None,
            });
        }
    }
    if let Some(stale) = node.take() {
        stale.stop().await?;
    }

    let handle = NodeHandle::start(app_data_dir, display_name).await?;
    let snapshot = handle.snapshot.read().await.clone();
    let lease_id = handle.lease_id;
    *node = Some(handle);
    Ok(P2pStartResult {
        snapshot,
        lease_id: Some(lease_id),
    })
}

async fn stop_p2p_state(
    state: &P2pState,
    required_lease: Option<Uuid>,
) -> Result<P2pSnapshot, CommandError> {
    let mut node = state.node.lock().await;
    if let Some(handle) = node.as_ref()
        && required_lease.is_some_and(|lease_id| lease_id != handle.lease_id)
    {
        return Ok(handle.snapshot.read().await.clone());
    }
    let Some(handle) = node.take() else {
        return Ok(state.stopped_snapshot.read().await.clone());
    };
    let snapshot = handle.stop().await?;
    *state.stopped_snapshot.write().await = snapshot.clone();
    Ok(snapshot)
}

fn parse_lease_id(lease_id: Option<String>) -> Result<Option<Uuid>, CommandError> {
    lease_id
        .map(|value| {
            Uuid::parse_str(&value)
                .map_err(|_| p2p_error("P2P_INVALID_LEASE", "交换节点租约格式无效。"))
        })
        .transpose()
}

#[tauri::command]
pub async fn p2p_connect(
    connection_code: String,
    state: State<'_, P2pState>,
) -> Result<(), CommandError> {
    let sender = command_sender(&state).await?;
    let (reply, result) = oneshot::channel();
    sender
        .send(NodeCommand::Connect {
            connection_code,
            reply,
        })
        .await
        .map_err(|_| node_stopped())?;
    result.await.map_err(|_| node_stopped())?
}

#[tauri::command]
pub async fn p2p_send_offer(
    peer_id: String,
    deck: Value,
    state: State<'_, P2pState>,
) -> Result<String, CommandError> {
    let peer_id = peer_id
        .parse::<PeerId>()
        .map_err(|_| p2p_error("P2P_INVALID_PEER", "目标节点身份无效，请重新选择节点。"))?;
    validate_deck(&deck)?;
    let sender = command_sender(&state).await?;
    let (reply, result) = oneshot::channel();
    sender
        .send(NodeCommand::SendOffer {
            peer_id,
            deck,
            reply,
        })
        .await
        .map_err(|_| node_stopped())?;
    result.await.map_err(|_| node_stopped())?
}

#[tauri::command]
pub async fn p2p_respond_offer(
    offer_id: String,
    accept: bool,
    counter_deck: Option<Value>,
    state: State<'_, P2pState>,
) -> Result<(), CommandError> {
    if offer_id.len() > 64 || Uuid::parse_str(&offer_id).is_err() {
        return Err(p2p_error("P2P_INVALID_OFFER", "交换请求编号无效。"));
    }
    if accept && counter_deck.is_none() {
        return Err(p2p_error(
            "P2P_COUNTER_DECK_REQUIRED",
            "接受交换时需要选择一套回赠卡包。",
        ));
    }
    if let Some(deck) = counter_deck.as_ref() {
        validate_deck(deck)?;
    }

    let sender = command_sender(&state).await?;
    let (reply, result) = oneshot::channel();
    sender
        .send(NodeCommand::RespondOffer {
            offer_id,
            accept,
            counter_deck,
            reply,
        })
        .await
        .map_err(|_| node_stopped())?;
    result.await.map_err(|_| node_stopped())?
}

async fn command_sender(
    state: &State<'_, P2pState>,
) -> Result<mpsc::Sender<NodeCommand>, CommandError> {
    state
        .node
        .lock()
        .await
        .as_ref()
        .map(|handle| handle.commands.clone())
        .ok_or_else(node_not_running)
}

impl NodeHandle {
    async fn start(app_data_dir: PathBuf, display_name: String) -> Result<Self, CommandError> {
        let p2p_directory = app_data_dir.join("p2p");
        let identity_path = p2p_directory.join("identity.key");
        let offer_journal_path = p2p_directory.join(OFFER_JOURNAL_FILE_NAME);
        let keypair = load_or_create_identity(&identity_path)?;
        let local_peer_id = keypair.public().to_peer_id();
        let offers = load_offer_journal_at(&offer_journal_path, local_peer_id)?;
        let behaviour = build_behaviour(&keypair, local_peer_id, &display_name)?;
        let mut swarm = SwarmBuilder::with_existing_identity(keypair.clone())
            .with_tokio()
            .with_quic()
            .with_behaviour(|_| behaviour)
            .map_err(|error| p2p_error("P2P_START_FAILED", format!("无法初始化交换协议：{error}")))?
            .with_swarm_config(|config| {
                config.with_idle_connection_timeout(Duration::from_secs(120))
            })
            .build();

        swarm
            .listen_on(
                "/ip4/0.0.0.0/udp/0/quic-v1"
                    .parse()
                    .expect("static IPv4 listen address"),
            )
            .map_err(|error| {
                p2p_error(
                    "P2P_LISTEN_FAILED",
                    format!("无法打开本机 P2P 监听端口：{error:?}"),
                )
            })?;
        let _ = swarm.listen_on(
            "/ip6/::/udp/0/quic-v1"
                .parse()
                .expect("static IPv6 listen address"),
        );

        let identity = P2pIdentity {
            peer_id: local_peer_id.to_string(),
            display_name: display_name.clone(),
            connection_code: String::new(),
            listen_addresses: Vec::new(),
        };
        let snapshot = Arc::new(RwLock::new(P2pSnapshot {
            running: true,
            identity: Some(identity),
            peers: Vec::new(),
            offers: offers.clone(),
            last_error: None,
        }));
        let (commands, receiver) = mpsc::channel(32);
        let runtime = NodeRuntime {
            swarm,
            keypair,
            local_peer_id,
            display_name,
            snapshot: Arc::clone(&snapshot),
            peers: HashMap::new(),
            offers,
            offer_journal_path,
            listen_addresses: HashSet::new(),
            pending: HashMap::new(),
        };
        let task = tokio::spawn(runtime.run(receiver));

        Ok(Self {
            commands,
            snapshot,
            task,
            lease_id: Uuid::new_v4(),
        })
    }

    async fn stop(self) -> Result<P2pSnapshot, CommandError> {
        let Self {
            commands,
            snapshot,
            task,
            lease_id: _,
        } = self;
        let _ = commands.send(NodeCommand::Stop).await;
        drop(commands);
        task.await.map_err(|_| node_stop_failed())?;
        let snapshot = snapshot.read().await.clone();
        Ok(snapshot)
    }
}

impl NodeRuntime {
    async fn run(mut self, mut commands: mpsc::Receiver<NodeCommand>) {
        loop {
            tokio::select! {
                command = commands.recv() => {
                    let Some(command) = command else { break };
                    if !self.handle_command(command).await {
                        break;
                    }
                }
                event = self.swarm.select_next_some() => {
                    self.handle_swarm_event(event).await;
                }
            }
        }
        let mut snapshot = self.snapshot.write().await;
        snapshot.running = false;
        snapshot.peers.clear();
        snapshot.offers = self.offers.clone();
        snapshot.last_error = None;
        if let Some(identity) = snapshot.identity.as_mut() {
            identity.connection_code.clear();
            identity.listen_addresses.clear();
        }
    }

    async fn handle_command(&mut self, command: NodeCommand) -> bool {
        match command {
            NodeCommand::Stop => return false,
            NodeCommand::Connect {
                connection_code,
                reply,
            } => {
                let result = self.connect(&connection_code);
                let _ = reply.send(result);
            }
            NodeCommand::SendOffer {
                peer_id,
                deck,
                reply,
            } => self.send_offer(peer_id, deck, reply).await,
            NodeCommand::RespondOffer {
                offer_id,
                accept,
                counter_deck,
                reply,
            } => {
                self.respond_offer(offer_id, accept, counter_deck, reply)
                    .await
            }
        }
        true
    }

    fn connect(&mut self, connection_code: &str) -> Result<(), CommandError> {
        if connection_code.is_empty() || connection_code.len() > MAX_CONNECTION_CODE_BYTES {
            return Err(p2p_error("P2P_INVALID_CONNECTION_CODE", "连接码格式无效。"));
        }
        let addresses = connection_code
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::parse::<Multiaddr>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| p2p_error("P2P_INVALID_CONNECTION_CODE", "连接码格式无效。"))?;
        if addresses.is_empty() || addresses.len() > 12 {
            return Err(p2p_error("P2P_INVALID_CONNECTION_CODE", "连接码格式无效。"));
        }

        let mut dialed = false;
        let mut expected_peer = None;
        for address in addresses {
            let peer = peer_id_from_address(&address)
                .ok_or_else(|| p2p_error("P2P_INVALID_CONNECTION_CODE", "连接码缺少节点身份。"))?;
            if peer == self.local_peer_id {
                continue;
            }
            if expected_peer.is_some_and(|expected| expected != peer) {
                return Err(p2p_error(
                    "P2P_INVALID_CONNECTION_CODE",
                    "连接码包含多个不同节点。",
                ));
            }
            expected_peer = Some(peer);
            if self.swarm.dial(address).is_ok() {
                dialed = true;
            }
        }
        if !dialed {
            return Err(p2p_error(
                "P2P_CONNECT_FAILED",
                "无法向该节点发起连接，请检查网络与连接码。",
            ));
        }
        Ok(())
    }

    async fn send_offer(
        &mut self,
        peer_id: PeerId,
        deck: Value,
        reply: oneshot::Sender<Result<String, CommandError>>,
    ) {
        let connected = self
            .peers
            .get(&peer_id)
            .is_some_and(|peer| peer.connected && peer.verified);
        if !connected {
            let _ = reply.send(Err(p2p_error(
                "P2P_PEER_NOT_CONNECTED",
                "目标节点尚未建立可信连接。",
            )));
            return;
        }
        let signed_deck = match sign_deck(&self.keypair, self.local_peer_id, deck) {
            Ok(deck) => deck,
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        let offer_id = Uuid::new_v4().to_string();
        let created_at = now_millis();
        let request = WireRequest::Offer(SignedOffer {
            offer_id: offer_id.clone(),
            sender_name: self.display_name.clone(),
            deck: signed_deck.clone(),
            created_at,
        });
        if validate_wire_size(&request).is_err() {
            let _ = reply.send(Err(bundle_too_large()));
            return;
        }

        let archived_deck = deck_with_provenance(&signed_deck);
        let deck_bytes = encoded_value_size(&archived_deck);
        let peer_name = self.peer_name(&peer_id);
        let mut next_offers = self.offers.clone();
        if let Err(error) = reserve_offer_capacity(&mut next_offers, MAX_DECK_BYTES) {
            let _ = reply.send(Err(error));
            return;
        }
        next_offers.insert(
            0,
            ExchangeOffer {
                id: offer_id.clone(),
                direction: OfferDirection::Outgoing,
                status: OfferStatus::Pending,
                peer_id: peer_id.to_string(),
                peer_name,
                deck: Arc::new(archived_deck),
                cid: signed_deck.cid.clone(),
                signature_valid: true,
                created_at,
                deck_bytes,
            },
        );
        if let Err(error) = self.commit_offer_history(next_offers).await {
            let _ = reply.send(Err(error));
            return;
        }
        let request_id = self
            .swarm
            .behaviour_mut()
            .exchange
            .send_request(&peer_id, request);
        self.pending
            .insert(request_id, PendingOperation::Offer { offer_id, reply });
        self.publish_snapshot().await;
    }

    async fn respond_offer(
        &mut self,
        offer_id: String,
        accept: bool,
        counter_deck: Option<Value>,
        reply: oneshot::Sender<Result<(), CommandError>>,
    ) {
        let Some(offer_index) = self.offers.iter().position(|offer| {
            offer.id == offer_id
                && matches!(offer.direction, OfferDirection::Incoming)
                && matches!(offer.status, OfferStatus::Pending)
        }) else {
            let _ = reply.send(Err(p2p_error(
                "P2P_OFFER_NOT_PENDING",
                "该交换请求不存在或已处理。",
            )));
            return;
        };
        let peer_id = match self.offers[offer_index].peer_id.parse::<PeerId>() {
            Ok(peer_id) => peer_id,
            Err(_) => {
                let _ = reply.send(Err(p2p_error(
                    "P2P_INVALID_PEER",
                    "交换请求中的节点身份无效。",
                )));
                return;
            }
        };
        let signed_counter = match counter_deck {
            Some(deck) => match sign_deck(&self.keypair, self.local_peer_id, deck) {
                Ok(deck) => Some(deck),
                Err(error) => {
                    let _ = reply.send(Err(error));
                    return;
                }
            },
            None => None,
        };
        let request = WireRequest::Decision(SignedDecision {
            offer_id: offer_id.clone(),
            sender_name: self.display_name.clone(),
            accept,
            counter_deck: signed_counter,
            created_at: now_millis(),
        });
        if validate_wire_size(&request).is_err() {
            let _ = reply.send(Err(bundle_too_large()));
            return;
        }
        let mut next_offers = self.offers.clone();
        next_offers[offer_index].status = if accept {
            OfferStatus::Accepted
        } else {
            OfferStatus::Declined
        };
        if let Err(error) = self.commit_offer_history(next_offers).await {
            let _ = reply.send(Err(error));
            return;
        }
        let request_id = self
            .swarm
            .behaviour_mut()
            .exchange
            .send_request(&peer_id, request);
        self.pending.insert(
            request_id,
            PendingOperation::Decision {
                offer_id,
                accept,
                reply,
            },
        );
        self.publish_snapshot().await;
    }

    async fn handle_swarm_event(&mut self, event: SwarmEvent<BehaviourEvent>) {
        match event {
            SwarmEvent::Behaviour(BehaviourEvent::Mdns(event)) => self.handle_mdns(event).await,
            SwarmEvent::Behaviour(BehaviourEvent::Identify(event)) => {
                self.handle_identify(event).await
            }
            SwarmEvent::Behaviour(BehaviourEvent::Exchange(event)) => {
                self.handle_exchange(event).await
            }
            SwarmEvent::Behaviour(BehaviourEvent::Ping(event)) => self.handle_ping(event).await,
            SwarmEvent::ConnectionEstablished {
                peer_id, endpoint, ..
            } => {
                let address = endpoint.get_remote_address().to_string();
                let peer = self.peer_entry(peer_id, address);
                peer.connected = true;
                peer.last_seen = now_millis();
                self.publish_snapshot().await;
            }
            SwarmEvent::ConnectionClosed { peer_id, .. } => {
                if !self.swarm.is_connected(&peer_id) {
                    if let Some(peer) = self.peers.get_mut(&peer_id) {
                        peer.connected = false;
                        peer.last_seen = now_millis();
                    }
                    self.publish_snapshot().await;
                }
            }
            SwarmEvent::NewListenAddr { address, .. } => {
                self.add_listen_address(address);
                self.publish_snapshot().await;
            }
            SwarmEvent::ExpiredListenAddr { address, .. } => {
                for expired in routable_variants(&address) {
                    self.listen_addresses.remove(&expired);
                }
                self.publish_snapshot().await;
            }
            SwarmEvent::ListenerError { error, .. } => {
                self.set_last_error(format!("P2P 监听异常：{error}")).await;
            }
            _ => {}
        }
    }

    async fn handle_mdns(&mut self, event: mdns::Event) {
        match event {
            mdns::Event::Discovered(entries) => {
                for (peer_id, address) in entries {
                    if peer_id == self.local_peer_id {
                        continue;
                    }
                    let peer = self.peer_entry(peer_id, address.to_string());
                    peer.nearby = true;
                    peer.last_seen = now_millis();
                    if !self.swarm.is_connected(&peer_id) {
                        let dial_address = with_peer_id(address, peer_id);
                        let _ = self.swarm.dial(dial_address);
                    }
                }
                self.publish_snapshot().await;
            }
            mdns::Event::Expired(entries) => {
                for (peer_id, _) in entries {
                    if let Some(peer) = self.peers.get_mut(&peer_id) {
                        peer.nearby = false;
                    }
                }
                self.publish_snapshot().await;
            }
        }
    }

    async fn handle_identify(&mut self, event: identify::Event) {
        if let identify::Event::Received { peer_id, info, .. } = event {
            let display_name = display_name_from_agent(&info.agent_version);
            let peer = self.peer_entry(peer_id, info.observed_addr.to_string());
            peer.verified = true;
            peer.last_seen = now_millis();
            if let Some(name) = display_name {
                peer.display_name = name;
            }
            for address in info.listen_addrs {
                self.swarm.add_peer_address(peer_id, address);
            }
            self.publish_snapshot().await;
        }
    }

    async fn handle_ping(&mut self, event: ping::Event) {
        if let Some(peer) = self.peers.get_mut(&event.peer) {
            peer.last_seen = now_millis();
            if event.result.is_err() && !self.swarm.is_connected(&event.peer) {
                peer.connected = false;
            }
            self.publish_snapshot().await;
        }
    }

    async fn handle_exchange(&mut self, event: request_response::Event<WireRequest, WireResponse>) {
        match event {
            request_response::Event::Message { peer, message, .. } => match message {
                request_response::Message::Request {
                    request, channel, ..
                } => {
                    let response = match self.handle_incoming_request(peer, request).await {
                        Ok(()) => WireResponse {
                            ok: true,
                            error: None,
                        },
                        Err(error) => WireResponse {
                            ok: false,
                            error: Some(error.message),
                        },
                    };
                    let _ = self
                        .swarm
                        .behaviour_mut()
                        .exchange
                        .send_response(channel, response);
                }
                request_response::Message::Response {
                    request_id,
                    response,
                } => self.handle_outbound_response(request_id, response).await,
            },
            request_response::Event::OutboundFailure {
                request_id, error, ..
            } => {
                self.handle_outbound_failure(request_id, error.to_string())
                    .await
            }
            request_response::Event::InboundFailure { error, .. } => {
                self.set_last_error(format!("收到无效的交换数据：{error}"))
                    .await;
            }
            request_response::Event::ResponseSent { .. } => {}
        }
    }

    async fn handle_incoming_request(
        &mut self,
        peer_id: PeerId,
        request: WireRequest,
    ) -> Result<(), CommandError> {
        validate_wire_size(&request)?;
        match request {
            WireRequest::Offer(offer) => {
                let sender_name = sanitize_remote_display_name(&offer.sender_name);
                if let Some(next_offers) =
                    prepare_incoming_offer_history(&self.offers, peer_id, &offer)?
                {
                    self.commit_offer_history(next_offers).await?;
                }
                self.mark_peer_verified(peer_id, &sender_name);
            }
            WireRequest::Decision(decision) => {
                let sender_name = sanitize_remote_display_name(&decision.sender_name);
                if let Some(next_offers) =
                    prepare_incoming_decision_history(&self.offers, peer_id, &decision)?
                {
                    self.commit_offer_history(next_offers).await?;
                }
                self.mark_peer_verified(peer_id, &sender_name);
            }
        }
        self.publish_snapshot().await;
        Ok(())
    }

    async fn handle_outbound_response(
        &mut self,
        request_id: request_response::OutboundRequestId,
        response: WireResponse,
    ) {
        let Some(operation) = self.pending.remove(&request_id) else {
            return;
        };
        match operation {
            PendingOperation::Offer { offer_id, reply } => {
                if response.ok {
                    let _ = reply.send(Ok(offer_id));
                } else {
                    let result = self
                        .set_offer_status_persisted(&offer_id, OfferStatus::Failed)
                        .await;
                    let _ = reply.send(Err(match result {
                        Ok(()) => remote_rejected(response.error),
                        Err(error) => error,
                    }));
                }
            }
            PendingOperation::Decision {
                offer_id,
                accept,
                reply,
            } => {
                if response.ok {
                    let status = if accept {
                        OfferStatus::Completed
                    } else {
                        OfferStatus::Declined
                    };
                    let _ = reply.send(self.set_offer_status_persisted(&offer_id, status).await);
                } else {
                    let result = self
                        .set_offer_status_persisted(&offer_id, OfferStatus::Failed)
                        .await;
                    let _ = reply.send(Err(match result {
                        Ok(()) => remote_rejected(response.error),
                        Err(error) => error,
                    }));
                }
            }
        }
        self.publish_snapshot().await;
    }

    async fn handle_outbound_failure(
        &mut self,
        request_id: request_response::OutboundRequestId,
        detail: String,
    ) {
        let Some(operation) = self.pending.remove(&request_id) else {
            return;
        };
        let error = p2p_error(
            "P2P_DELIVERY_FAILED",
            "交换消息未能送达，请检查双方网络后重试。",
        );
        match operation {
            PendingOperation::Offer { offer_id, reply } => {
                let result = self
                    .set_offer_status_persisted(&offer_id, OfferStatus::Failed)
                    .await;
                let _ = reply.send(Err(result.err().unwrap_or(error)));
            }
            PendingOperation::Decision {
                offer_id, reply, ..
            } => {
                let result = self
                    .set_offer_status_persisted(&offer_id, OfferStatus::Failed)
                    .await;
                let _ = reply.send(Err(result.err().unwrap_or(error)));
            }
        }
        self.set_last_error(format!("交换消息发送失败：{detail}"))
            .await;
        self.publish_snapshot().await;
    }

    fn peer_entry(&mut self, peer_id: PeerId, address: String) -> &mut P2pPeer {
        self.peers.entry(peer_id).or_insert_with(|| P2pPeer {
            peer_id: peer_id.to_string(),
            display_name: "匿名锻卡师".to_owned(),
            address,
            connected: false,
            nearby: false,
            verified: false,
            last_seen: now_millis(),
        })
    }

    fn mark_peer_verified(&mut self, peer_id: PeerId, name: &str) {
        let peer = self.peer_entry(peer_id, String::new());
        peer.verified = true;
        peer.connected = true;
        peer.last_seen = now_millis();
        if !name.is_empty() {
            peer.display_name = name.to_owned();
        }
    }

    fn peer_name(&self, peer_id: &PeerId) -> String {
        self.peers
            .get(peer_id)
            .map(|peer| peer.display_name.clone())
            .unwrap_or_else(|| "匿名锻卡师".to_owned())
    }

    async fn set_offer_status_persisted(
        &mut self,
        offer_id: &str,
        status: OfferStatus,
    ) -> Result<(), CommandError> {
        let mut next_offers = self.offers.clone();
        let offer = next_offers
            .iter_mut()
            .find(|offer| offer.id == offer_id)
            .ok_or_else(|| {
                p2p_error(
                    "P2P_OFFER_NOT_FOUND",
                    "交换记录不存在，无法更新本机交换日志。",
                )
            })?;
        offer.status = status;
        self.commit_offer_history(next_offers).await
    }

    async fn commit_offer_history(
        &mut self,
        next_offers: Vec<ExchangeOffer>,
    ) -> Result<(), CommandError> {
        let persisted_offers = next_offers.clone();
        let path = self.offer_journal_path.clone();
        let local_peer_id = self.local_peer_id;
        tokio::task::spawn_blocking(move || {
            save_offer_journal_at(&path, local_peer_id, &persisted_offers)
        })
        .await
        .map_err(|_| offer_journal_write_error())??;
        self.offers = next_offers;
        Ok(())
    }

    fn add_listen_address(&mut self, address: Multiaddr) {
        for address in routable_variants(&address) {
            self.listen_addresses.insert(address);
        }
    }

    async fn set_last_error(&mut self, message: String) {
        let snapshot = Arc::clone(&self.snapshot);
        snapshot.write().await.last_error = Some(message);
    }

    async fn publish_snapshot(&mut self) {
        let mut peers = self.peers.values().cloned().collect::<Vec<_>>();
        peers.sort_by(|left, right| {
            right
                .connected
                .cmp(&left.connected)
                .then_with(|| right.nearby.cmp(&left.nearby))
                .then_with(|| right.last_seen.cmp(&left.last_seen))
        });
        let mut listen_addresses = self
            .listen_addresses
            .iter()
            .cloned()
            .map(|address| with_peer_id(address, self.local_peer_id).to_string())
            .collect::<Vec<_>>();
        listen_addresses.sort_by(|left, right| {
            address_priority(left)
                .cmp(&address_priority(right))
                .then_with(|| left.cmp(right))
        });
        listen_addresses.dedup();
        let connection_code = build_connection_code(&listen_addresses);

        let shared_snapshot = Arc::clone(&self.snapshot);
        let mut snapshot = shared_snapshot.write().await;
        snapshot.running = true;
        snapshot.peers = peers;
        snapshot.offers = self.offers.clone();
        if let Some(identity) = snapshot.identity.as_mut() {
            identity.listen_addresses = listen_addresses;
            identity.connection_code = connection_code;
        }
    }
}

fn prepare_incoming_offer_history(
    current: &[ExchangeOffer],
    peer_id: PeerId,
    offer: &SignedOffer,
) -> Result<Option<Vec<ExchangeOffer>>, CommandError> {
    validate_offer_id(&offer.offer_id)?;
    let deck = verify_deck(&offer.deck, peer_id)?;
    let peer_id_text = peer_id.to_string();

    if let Some(existing) = current
        .iter()
        .find(|existing| existing.id == offer.offer_id)
    {
        if existing.direction == OfferDirection::Incoming
            && existing.peer_id == peer_id_text
            && existing.cid == offer.deck.cid
            && existing.signature_valid
        {
            return Ok(None);
        }
        return Err(offer_conflict());
    }

    let unresolved_from_peer = current
        .iter()
        .filter(|existing| {
            existing.direction == OfferDirection::Incoming
                && existing.peer_id == peer_id_text
                && matches!(
                    existing.status,
                    OfferStatus::Pending | OfferStatus::Accepted
                )
        })
        .count();
    if unresolved_from_peer >= MAX_PENDING_INCOMING_OFFERS_PER_PEER {
        return Err(p2p_error(
            "P2P_PEER_PENDING_LIMIT",
            "该节点已有 2 条待处理交换请求，请先处理后再接收新请求。",
        ));
    }

    let deck_bytes = encoded_value_size(&deck);
    let mut next = current.to_vec();
    reserve_offer_capacity(&mut next, deck_bytes)?;
    next.insert(
        0,
        ExchangeOffer {
            id: offer.offer_id.clone(),
            direction: OfferDirection::Incoming,
            status: OfferStatus::Pending,
            peer_id: peer_id_text,
            peer_name: sanitize_remote_display_name(&offer.sender_name),
            deck: Arc::new(deck),
            cid: offer.deck.cid.clone(),
            signature_valid: true,
            created_at: valid_timestamp(offer.created_at),
            deck_bytes,
        },
    );
    Ok(Some(next))
}

fn prepare_incoming_decision_history(
    current: &[ExchangeOffer],
    peer_id: PeerId,
    decision: &SignedDecision,
) -> Result<Option<Vec<ExchangeOffer>>, CommandError> {
    validate_offer_id(&decision.offer_id)?;
    if !decision.accept && decision.counter_deck.is_some() {
        return Err(p2p_error(
            "P2P_INVALID_DECISION",
            "拒绝交换时不得附带卡包。",
        ));
    }

    let peer_id_text = peer_id.to_string();
    let Some(index) = current
        .iter()
        .position(|offer| offer.id == decision.offer_id)
    else {
        return Err(p2p_error(
            "P2P_OFFER_NOT_PENDING",
            "对应的交换请求不存在或已处理。",
        ));
    };
    let existing = &current[index];
    if existing.direction != OfferDirection::Outgoing || existing.peer_id != peer_id_text {
        return Err(offer_conflict());
    }

    if decision.accept {
        let counter = decision
            .counter_deck
            .as_ref()
            .ok_or_else(|| p2p_error("P2P_INVALID_DECISION", "对方接受交换但未提供回赠卡包。"))?;
        let deck = verify_deck(counter, peer_id)?;
        if existing.status == OfferStatus::Completed
            && existing.cid == counter.cid
            && existing.signature_valid
        {
            return Ok(None);
        }
        if existing.status != OfferStatus::Pending {
            return Err(offer_conflict());
        }

        let deck_bytes = encoded_value_size(&deck);
        let mut next = current.to_vec();
        let mut completed = next.remove(index);
        completed.deck = Arc::new(deck);
        completed.cid = counter.cid.clone();
        completed.signature_valid = true;
        completed.status = OfferStatus::Completed;
        completed.deck_bytes = deck_bytes;
        next.insert(0, completed);
        Ok(Some(next))
    } else if existing.status == OfferStatus::Declined {
        Ok(None)
    } else if existing.status == OfferStatus::Pending {
        let mut next = current.to_vec();
        next[index].status = OfferStatus::Declined;
        Ok(Some(next))
    } else {
        Err(offer_conflict())
    }
}

fn validate_offer_id(offer_id: &str) -> Result<(), CommandError> {
    if offer_id.len() <= 64 && Uuid::parse_str(offer_id).is_ok() {
        Ok(())
    } else {
        Err(p2p_error("P2P_INVALID_OFFER", "交换请求编号无效。"))
    }
}

fn offer_conflict() -> CommandError {
    p2p_error(
        "P2P_OFFER_CONFLICT",
        "交换请求编号已被其他节点或不同内容使用，已拒绝覆盖本机记录。",
    )
}

fn build_behaviour(
    keypair: &identity::Keypair,
    local_peer_id: PeerId,
    display_name: &str,
) -> Result<Behaviour, CommandError> {
    let exchange = request_response::Behaviour::with_codec(
        WireCodec,
        [(
            StreamProtocol::new(EXCHANGE_PROTOCOL),
            ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(Duration::from_secs(120)),
    );
    let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), local_peer_id)
        .map_err(|_| p2p_error("P2P_DISCOVERY_FAILED", "无法启动局域网节点发现服务。"))?;
    let identify = identify::Behaviour::new(
        identify::Config::new(IDENTIFY_PROTOCOL.to_owned(), keypair.public())
            .with_agent_version(agent_version(display_name)),
    );
    let ping = ping::Behaviour::new(
        ping::Config::new()
            .with_interval(Duration::from_secs(15))
            .with_timeout(Duration::from_secs(10)),
    );
    Ok(Behaviour {
        exchange,
        mdns,
        identify,
        ping,
    })
}

async fn read_json_message<T, Message>(io: &mut T, maximum_bytes: usize) -> io::Result<Message>
where
    T: AsyncRead + Unpin + Send,
    Message: serde::de::DeserializeOwned,
{
    let mut bytes = Vec::new();
    io.take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() > maximum_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "P2P message exceeds the configured limit",
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

async fn write_json_message<T, Message>(
    io: &mut T,
    message: &Message,
    maximum_bytes: usize,
) -> io::Result<()>
where
    T: AsyncWrite + Unpin + Send,
    Message: Serialize,
{
    let bytes = serde_json::to_vec(message)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if bytes.len() > maximum_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "P2P message exceeds the configured limit",
        ));
    }
    io.write_all(&bytes).await
}

fn load_offer_journal_at(
    path: &Path,
    local_peer_id: PeerId,
) -> Result<Vec<ExchangeOffer>, CommandError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(offer_journal_corrupt_error());
        }
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(offer_journal_read_error()),
    };
    if metadata.len() > MAX_OFFER_JOURNAL_BYTES as u64 {
        return Err(offer_journal_too_large_error());
    }

    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| offer_journal_read_error())?
        .take(MAX_OFFER_JOURNAL_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| offer_journal_read_error())?;
    if bytes.len() > MAX_OFFER_JOURNAL_BYTES {
        return Err(offer_journal_too_large_error());
    }
    let journal: OfferJournal =
        serde_json::from_slice(&bytes).map_err(|_| offer_journal_corrupt_error())?;
    if journal.schema_version != OFFER_JOURNAL_SCHEMA_VERSION {
        return Err(p2p_error(
            "P2P_JOURNAL_VERSION_UNSUPPORTED",
            "本机交换日志版本不受支持，原文件未被覆盖。",
        ));
    }
    if journal.local_peer_id != local_peer_id.to_string() {
        return Err(p2p_error(
            "P2P_JOURNAL_IDENTITY_MISMATCH",
            "本机交换日志属于另一 P2P 身份，原文件未被覆盖。",
        ));
    }
    if journal.offers.len() > MAX_OFFERS {
        return Err(offer_journal_limit_error());
    }

    let mut offers = Vec::with_capacity(journal.offers.len());
    let mut offer_ids = HashSet::with_capacity(journal.offers.len());
    for persisted in journal.offers {
        if !offer_ids.insert(persisted.id.clone()) {
            return Err(offer_journal_corrupt_error());
        }
        offers.push(exchange_offer_from_persisted(persisted, local_peer_id)?);
    }
    validate_offer_journal_budget(&offers)?;
    Ok(offers)
}

fn save_offer_journal_at(
    path: &Path,
    local_peer_id: PeerId,
    offers: &[ExchangeOffer],
) -> Result<(), CommandError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            // Never silently replace a journal that became corrupt or belongs to another identity.
            load_offer_journal_at(path, local_peer_id)?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Err(offer_journal_read_error()),
    }
    if offers.len() > MAX_OFFERS {
        return Err(offer_journal_limit_error());
    }
    validate_offer_journal_budget(offers)?;

    let mut offer_ids = HashSet::with_capacity(offers.len());
    let mut persisted_offers = Vec::with_capacity(offers.len());
    for offer in offers {
        if !offer_ids.insert(offer.id.clone()) {
            return Err(offer_journal_corrupt_error());
        }
        let mut persisted = persisted_offer(offer);
        let (_, signature_valid) = validate_persisted_offer(&persisted, local_peer_id)?;
        persisted.signature_valid = signature_valid;
        persisted_offers.push(persisted);
    }
    let journal = OfferJournal {
        schema_version: OFFER_JOURNAL_SCHEMA_VERSION,
        local_peer_id: local_peer_id.to_string(),
        offers: persisted_offers,
    };
    let bytes = serde_json::to_vec(&journal).map_err(|_| offer_journal_write_error())?;
    if bytes.len() > MAX_OFFER_JOURNAL_BYTES {
        return Err(offer_journal_too_large_error());
    }
    atomic_offer_journal_write(path, &bytes).map_err(|_| offer_journal_write_error())
}

fn persisted_offer(offer: &ExchangeOffer) -> PersistedExchangeOffer {
    PersistedExchangeOffer {
        id: offer.id.clone(),
        direction: offer.direction,
        status: offer.status,
        peer_id: offer.peer_id.clone(),
        peer_name: offer.peer_name.clone(),
        deck: offer.deck.as_ref().clone(),
        cid: offer.cid.clone(),
        signature_valid: offer.signature_valid,
        created_at: offer.created_at,
    }
}

fn exchange_offer_from_persisted(
    persisted: PersistedExchangeOffer,
    local_peer_id: PeerId,
) -> Result<ExchangeOffer, CommandError> {
    let (deck_bytes, signature_valid) = validate_persisted_offer(&persisted, local_peer_id)?;
    let status = if persisted.direction == OfferDirection::Incoming
        && persisted.status == OfferStatus::Accepted
    {
        OfferStatus::Pending
    } else {
        persisted.status
    };
    Ok(ExchangeOffer {
        id: persisted.id,
        direction: persisted.direction,
        status,
        peer_id: persisted.peer_id,
        peer_name: persisted.peer_name,
        deck: Arc::new(persisted.deck),
        cid: persisted.cid,
        signature_valid,
        created_at: persisted.created_at,
        deck_bytes,
    })
}

fn validate_persisted_offer(
    persisted: &PersistedExchangeOffer,
    local_peer_id: PeerId,
) -> Result<(usize, bool), CommandError> {
    validate_offer_id(&persisted.id).map_err(|_| offer_journal_corrupt_error())?;
    let remote_peer_id = persisted
        .peer_id
        .parse::<PeerId>()
        .map_err(|_| offer_journal_corrupt_error())?;
    if remote_peer_id == local_peer_id
        || !sanitize_display_name(&persisted.peer_name)
            .is_ok_and(|name| name == persisted.peer_name)
        || !valid_cid(&persisted.cid)
        || persisted.created_at > MAX_JS_SAFE_INTEGER
        || (persisted.direction == OfferDirection::Outgoing
            && persisted.status == OfferStatus::Accepted)
    {
        return Err(offer_journal_corrupt_error());
    }

    let provenance = persisted
        .deck
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or_else(offer_journal_corrupt_error)?;
    if provenance.get("cid").and_then(Value::as_str) != Some(persisted.cid.as_str()) {
        return Err(offer_journal_corrupt_error());
    }
    let expected_signer = if persisted.direction == OfferDirection::Outgoing
        && persisted.status != OfferStatus::Completed
    {
        local_peer_id
    } else {
        remote_peer_id
    };
    let expected_signer_id = expected_signer.to_string();
    if provenance.get("signerPeerId").and_then(Value::as_str) != Some(expected_signer_id.as_str()) {
        return Err(offer_journal_corrupt_error());
    }
    let signature = provenance
        .get("signature")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(offer_journal_corrupt_error)?;

    let (_, _, computed_cid) =
        canonical_deck(persisted.deck.clone()).map_err(|_| offer_journal_corrupt_error())?;
    if computed_cid != persisted.cid {
        return Err(offer_journal_corrupt_error());
    }
    let deck_bytes = encoded_value_size(&persisted.deck);
    if deck_bytes > MAX_WIRE_BYTES {
        return Err(offer_journal_too_large_error());
    }
    let signature_valid = match provenance.get("publicKey") {
        Some(public_key) => {
            if provenance.len() != 4 {
                return Err(offer_journal_corrupt_error());
            }
            let public_key = public_key
                .as_str()
                .ok_or_else(offer_journal_corrupt_error)?;
            verify_signature_parts(
                &persisted.cid,
                &expected_signer_id,
                public_key,
                signature,
                expected_signer,
            )
            .map_err(|_| offer_journal_corrupt_error())?;
            true
        }
        None => {
            if provenance.len() != 3 {
                return Err(offer_journal_corrupt_error());
            }
            let signature_bytes = BASE64
                .decode(signature.as_bytes())
                .map_err(|_| offer_journal_corrupt_error())?;
            if signature_bytes.is_empty() || signature_bytes.len() > 128 {
                return Err(offer_journal_corrupt_error());
            }
            false
        }
    };
    Ok((deck_bytes, signature_valid))
}

fn validate_offer_journal_budget(offers: &[ExchangeOffer]) -> Result<(), CommandError> {
    if offers.len() > MAX_OFFERS {
        return Err(offer_journal_limit_error());
    }
    let retained_bytes = offers.iter().try_fold(0usize, |total, offer| {
        total.checked_add(offer_budget_bytes(offer))
    });
    if retained_bytes.is_none_or(|bytes| bytes > MAX_OFFER_HISTORY_BYTES) {
        return Err(offer_journal_too_large_error());
    }
    Ok(())
}

fn atomic_offer_journal_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing P2P directory"))?;
    fs::create_dir_all(parent)?;
    let temporary_path = parent.join(format!(".{OFFER_JOURNAL_FILE_NAME}.{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut temporary_file = options.open(&temporary_path)?;
    let result = (|| {
        temporary_file.write_all(bytes)?;
        temporary_file.sync_all()?;
        drop(temporary_file);
        fs::rename(&temporary_path, path)?;
        secure_offer_journal_permissions(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(unix)]
fn secure_offer_journal_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let metadata = fs::metadata(path)?;
    if metadata.mode() & 0o777 != 0o600 {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn secure_offer_journal_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn load_or_create_identity(path: &Path) -> Result<identity::Keypair, CommandError> {
    if path.exists() {
        let bytes = fs::read(path).map_err(|_| identity_storage_error())?;
        return identity::Keypair::from_protobuf_encoding(&bytes).map_err(|_| {
            p2p_error(
                "P2P_IDENTITY_CORRUPT",
                "本机 P2P 身份文件损坏，未自动覆盖以保护原身份。",
            )
        });
    }

    let parent = path.parent().ok_or_else(identity_storage_error)?;
    fs::create_dir_all(parent).map_err(|_| identity_storage_error())?;
    let keypair = identity::Keypair::generate_ed25519();
    let bytes = keypair
        .to_protobuf_encoding()
        .map_err(|_| identity_storage_error())?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    write_private_file(&temporary, &bytes).map_err(|_| identity_storage_error())?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        if path.exists() {
            let bytes = fs::read(path).map_err(|_| identity_storage_error())?;
            return identity::Keypair::from_protobuf_encoding(&bytes)
                .map_err(|_| identity_storage_error());
        }
        return Err(p2p_error(
            "P2P_STORAGE_UNAVAILABLE",
            format!("无法保存本机身份：{error}"),
        ));
    }
    Ok(keypair)
}

#[cfg(unix)]
fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn sign_deck(
    keypair: &identity::Keypair,
    local_peer_id: PeerId,
    deck: Value,
) -> Result<SignedDeck, CommandError> {
    let (deck, _canonical, cid) = canonical_deck(deck)?;
    let signature = keypair
        .sign(&signature_payload(&cid))
        .map_err(|_| p2p_error("P2P_SIGNING_FAILED", "无法签署卡包。"))?;
    Ok(SignedDeck {
        cid,
        signer_peer_id: local_peer_id.to_string(),
        public_key: URL_SAFE_NO_PAD.encode(keypair.public().encode_protobuf()),
        signature: BASE64.encode(signature),
        deck,
    })
}

fn verify_deck(signed: &SignedDeck, transport_peer: PeerId) -> Result<Value, CommandError> {
    verify_signature_parts(
        &signed.cid,
        &signed.signer_peer_id,
        &signed.public_key,
        &signed.signature,
        transport_peer,
    )?;
    let (deck, _, cid) = canonical_deck(signed.deck.clone())?;
    if cid != signed.cid {
        return Err(p2p_error(
            "P2P_HASH_MISMATCH",
            "卡包内容校验失败，已拒绝接收。",
        ));
    }
    Ok(deck_with_provenance_parts(
        deck,
        &signed.cid,
        &signed.signer_peer_id,
        &signed.public_key,
        &signed.signature,
    ))
}

fn verify_signature_parts(
    cid: &str,
    signer_peer_id: &str,
    public_key: &str,
    signature: &str,
    expected_peer: PeerId,
) -> Result<(), CommandError> {
    if !valid_cid(cid)
        || signer_peer_id.is_empty()
        || signer_peer_id.len() > 128
        || public_key.is_empty()
        || public_key.len() > 256
        || signature.is_empty()
        || signature.len() > 256
        || signer_peer_id != expected_peer.to_string()
    {
        return Err(invalid_signature());
    }
    let public_key_bytes = URL_SAFE_NO_PAD
        .decode(public_key.as_bytes())
        .map_err(|_| invalid_signature())?;
    let public_key = identity::PublicKey::try_decode_protobuf(&public_key_bytes)
        .map_err(|_| invalid_signature())?;
    if public_key.key_type() != identity::KeyType::Ed25519
        || PeerId::from_public_key(&public_key) != expected_peer
    {
        return Err(invalid_signature());
    }
    let signature = BASE64
        .decode(signature.as_bytes())
        .map_err(|_| invalid_signature())?;
    if signature.len() != 64 || !public_key.verify(&signature_payload(cid), &signature) {
        return Err(invalid_signature());
    }
    Ok(())
}

fn valid_cid(value: &str) -> bool {
    value.strip_prefix("blake3:").is_some_and(|digest| {
        digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn canonical_deck(mut deck: Value) -> Result<(Value, Vec<u8>, String), CommandError> {
    if let Some(object) = deck.as_object_mut() {
        object.remove("provenance");
    }
    validate_deck(&deck)?;
    let canonical = serde_json::to_vec(&deck)
        .map_err(|_| p2p_error("P2P_INVALID_DECK", "卡包数据无法编码。"))?;
    if canonical.len() > MAX_DECK_BYTES {
        return Err(bundle_too_large());
    }
    let cid = format!("blake3:{}", blake3::hash(&canonical).to_hex());
    Ok((deck, canonical, cid))
}

fn deck_with_provenance(signed: &SignedDeck) -> Value {
    deck_with_provenance_parts(
        signed.deck.clone(),
        &signed.cid,
        &signed.signer_peer_id,
        &signed.public_key,
        &signed.signature,
    )
}

fn deck_with_provenance_parts(
    mut deck: Value,
    cid: &str,
    signer_peer_id: &str,
    public_key: &str,
    signature: &str,
) -> Value {
    if let Some(object) = deck.as_object_mut() {
        object.insert(
            "provenance".to_owned(),
            json!({
                "cid": cid,
                "signerPeerId": signer_peer_id,
                "publicKey": public_key,
                "signature": signature,
            }),
        );
    }
    deck
}

fn validate_deck(deck: &Value) -> Result<(), CommandError> {
    let bytes = serde_json::to_vec(deck)
        .map_err(|_| p2p_error("P2P_INVALID_DECK", "卡包数据无法编码。"))?;
    if bytes.len() > MAX_DECK_BYTES {
        return Err(bundle_too_large());
    }
    let object = deck
        .as_object()
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡包数据格式无效。"))?;
    validate_exchange_content_policy(object.get("contentPolicy"))?;
    require_string(object, "id", 128)?;
    let theme = require_string(object, "theme", 240)?;
    let name = require_string(object, "name", 160)?;
    let story = require_string(object, "story", 12_000)?;
    let rules = require_string(object, "rules", 12_000)?;
    let author = require_string(object, "author", 160)?;
    let mode = require_string(object, "modeId", 32)?;
    if !matches!(
        mode,
        "reflex" | "memory" | "strategy" | "expression" | "mischief"
    ) {
        return Err(p2p_error("P2P_INVALID_DECK", "卡包玩法类型无效。"));
    }
    let cards = object
        .get("cards")
        .and_then(Value::as_array)
        .filter(|cards| !cards.is_empty() && cards.len() <= MAX_CARDS)
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡包中的卡牌数量无效。"))?;
    for card in cards {
        validate_card(card, mode)?;
    }
    if let Some(card_back) = object.get("cardBack") {
        validate_card_back(card_back)?;
    }
    if let Some(revision) = object.get("revision") {
        validate_deck_revision(revision)?;
    }
    ensure_youth_safe(&[theme, name, story, rules, author])?;
    crate::safety::validate_exchange_deck_schema(deck).map_err(|error| {
        if error.code.contains("UNSAFE") {
            p2p_error(
                "P2P_UNSAFE_DECK",
                "卡包包含不适合青少年的内容，已拒绝接收。",
            )
        } else {
            p2p_error("P2P_INVALID_DECK", "卡包的玩法、铭牌、铭文或版本结构无效。")
        }
    })?;
    Ok(())
}

fn validate_exchange_content_policy(content_policy: Option<&Value>) -> Result<(), CommandError> {
    let Some(content_policy) = content_policy else {
        return Ok(());
    };
    let object = content_policy
        .as_object()
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "套牌创作方式格式无效。"))?;
    let schema_version = object.get("schemaVersion").and_then(Value::as_u64);
    let mode = object.get("mode").and_then(Value::as_str);
    if mode == Some("fan-study") {
        return Err(p2p_error(
            "P2P_FAN_STUDY_LOCAL_ONLY",
            "个人同人研习套牌仅限本机使用，不能通过 P2P 交换。",
        ));
    }
    if schema_version == Some(1)
        && mode == Some("original")
        && object.len() == 2
        && object
            .keys()
            .all(|key| matches!(key.as_str(), "schemaVersion" | "mode"))
    {
        return Ok(());
    }
    Err(p2p_error("P2P_INVALID_DECK", "套牌创作方式字段无效。"))
}

fn validate_deck_revision(revision: &Value) -> Result<(), CommandError> {
    let object = revision
        .as_object()
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡包版本信息格式无效。"))?;
    if object.len() != 4
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "familyId" | "revision" | "createdAt" | "reason"
            )
        })
    {
        return Err(p2p_error("P2P_INVALID_DECK", "卡包版本字段无效。"));
    }
    require_string(object, "familyId", 128)?;
    let valid_revision = object
        .get("revision")
        .and_then(Value::as_u64)
        .is_some_and(|value| (1..=MAX_DECK_REVISION).contains(&value));
    let valid_created_at = object
        .get("createdAt")
        .and_then(Value::as_u64)
        .is_some_and(|value| value <= MAX_JS_SAFE_INTEGER);
    let valid_reason = object
        .get("reason")
        .and_then(Value::as_str)
        .is_some_and(|reason| {
            matches!(
                reason,
                "initial"
                    | "deck-generation"
                    | "card-regeneration"
                    | "manual-snapshot"
                    | "imported"
            )
        });
    if !valid_revision || !valid_created_at || !valid_reason {
        return Err(p2p_error("P2P_INVALID_DECK", "卡包版本信息无效。"));
    }
    Ok(())
}

fn validate_card(card: &Value, deck_mode: &str) -> Result<(), CommandError> {
    let object = card
        .as_object()
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡牌数据格式无效。"))?;
    require_string(object, "id", 128)?;
    let name = require_string(object, "name", 160)?;
    let title = require_string(object, "title", 240)?;
    let mode = require_string(object, "modeId", 32)?;
    if mode != deck_mode {
        return Err(p2p_error("P2P_INVALID_DECK", "卡牌玩法与所属套牌不一致。"));
    }
    let art_url = require_string(object, "artUrl", (MAX_ART_BYTES * 4 / 3) + 128)?;
    validate_art_url(art_url)?;
    let skill = require_string(object, "skill", 4000)?;
    let flavor = require_string(object, "flavor", 4000)?;
    let rarity = require_string(object, "rarity", 16)?;
    if !matches!(rarity, "普通" | "稀有" | "史诗" | "传说") {
        return Err(p2p_error("P2P_INVALID_DECK", "卡牌稀有度无效。"));
    }
    let author = require_string(object, "author", 160)?;
    if let Some(style) = object.get("inscriptionStyle")
        && !style
            .as_str()
            .is_some_and(|value| matches!(value, "seal" | "signature"))
    {
        return Err(p2p_error("P2P_INVALID_DECK", "作者铭文样式无效。"));
    }
    if let Some(placement) = object.get("inscriptionPlacement")
        && !placement
            .as_str()
            .is_some_and(|value| matches!(value, "front" | "back"))
    {
        return Err(p2p_error("P2P_INVALID_DECK", "作者铭文位置无效。"));
    }
    for (field, maximum) in [("attack", 99), ("defense", 99), ("cost", 9)] {
        if !object
            .get(field)
            .and_then(Value::as_i64)
            .is_some_and(|value| (0..=maximum).contains(&value))
        {
            return Err(p2p_error("P2P_INVALID_DECK", "卡牌数值字段无效。"));
        }
    }
    let gameplay_text = crate::gameplay::validate_card_gameplay(object.get("gameplay"))
        .map_err(|_| p2p_error("P2P_INVALID_DECK", "卡牌玩法绑定无效。"))?;
    let mut visible_text = vec![name, title, skill, flavor, author];
    visible_text.extend(gameplay_text);
    ensure_youth_safe(&visible_text)?;
    Ok(())
}

fn validate_card_back(card_back: &Value) -> Result<(), CommandError> {
    let object = card_back
        .as_object()
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡背设计格式无效。"))?;
    let style = require_string(object, "style", 32)?;
    if !matches!(style, "forge" | "constellation" | "circuit" | "sigil") {
        return Err(p2p_error("P2P_INVALID_DECK", "卡背设计样式无效。"));
    }
    if !object
        .get("seed")
        .and_then(Value::as_u64)
        .is_some_and(|seed| seed <= u64::from(u32::MAX))
    {
        return Err(p2p_error("P2P_INVALID_DECK", "卡背设计种子无效。"));
    }
    let label = require_string(object, "label", 160)?;
    if let Some(texture_url) = object.get("textureUrl") {
        let texture_url = texture_url
            .as_str()
            .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡背纹理格式无效。"))?;
        validate_art_url(texture_url)?;
    }
    ensure_youth_safe(&[label])
}

fn validate_art_url(value: &str) -> Result<(), CommandError> {
    if is_builtin_card_artwork_path(value) {
        return Ok(());
    }

    let (mime_type, encoded) = value
        .strip_prefix("data:")
        .and_then(|value| value.split_once(";base64,"))
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", "卡牌图片必须是受支持的本地资源。"))?;
    if !matches!(mime_type, "image/png" | "image/jpeg" | "image/webp")
        || encoded.is_empty()
        || encoded.len() > ((MAX_ART_BYTES * 4) / 3) + 8
    {
        return Err(p2p_error("P2P_INVALID_DECK", "卡牌图片格式或大小无效。"));
    }
    let bytes = BASE64_PADDED
        .decode(encoded.as_bytes())
        .or_else(|_| BASE64.decode(encoded.as_bytes()))
        .map_err(|_| p2p_error("P2P_INVALID_DECK", "卡牌图片编码无效。"))?;
    if bytes.is_empty() || bytes.len() > MAX_ART_BYTES {
        return Err(p2p_error("P2P_INVALID_DECK", "卡牌图片超过 4 MiB 限制。"));
    }
    let matching_signature = match mime_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if matching_signature {
        Ok(())
    } else {
        Err(p2p_error(
            "P2P_INVALID_DECK",
            "卡牌图片内容与声明格式不一致。",
        ))
    }
}

fn ensure_youth_safe(values: &[&str]) -> Result<(), CommandError> {
    let content = values.join("\n");
    if assess_youth_safety(&content).safe {
        Ok(())
    } else {
        Err(p2p_error(
            "P2P_UNSAFE_DECK",
            "卡包包含不适合青少年的文本，已拒绝接收。",
        ))
    }
}

fn require_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum_chars: usize,
) -> Result<&'a str, CommandError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .filter(|value| value.chars().count() <= maximum_chars)
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| p2p_error("P2P_INVALID_DECK", format!("卡包字段 {field} 无效。")))
}

fn validate_wire_size(request: &WireRequest) -> Result<(), CommandError> {
    let bytes = serde_json::to_vec(request)
        .map_err(|_| p2p_error("P2P_INVALID_MESSAGE", "交换消息无法编码。"))?;
    if bytes.len() > MAX_WIRE_BYTES {
        Err(bundle_too_large())
    } else {
        Ok(())
    }
}

fn encoded_value_size(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(MAX_DECK_BYTES, |bytes| bytes.len())
}

fn reserve_offer_capacity(
    offers: &mut Vec<ExchangeOffer>,
    new_offer_bytes: usize,
) -> Result<(), CommandError> {
    loop {
        let retained_bytes = offers.iter().fold(new_offer_bytes, |total, offer| {
            total.saturating_add(offer_budget_bytes(offer))
        });
        if offers.len() < MAX_OFFERS && retained_bytes <= MAX_OFFER_HISTORY_BYTES {
            return Ok(());
        }

        let terminal_index = offers
            .iter()
            .rposition(|offer| is_terminal_status(offer.status));
        if let Some(index) = terminal_index {
            offers.remove(index);
        } else {
            return Err(p2p_error(
                "P2P_NODE_BUSY",
                "当前进行中的交换较多，请先处理现有请求。",
            ));
        }
    }
}

fn offer_budget_bytes(offer: &ExchangeOffer) -> usize {
    if matches!(offer.direction, OfferDirection::Outgoing)
        && matches!(offer.status, OfferStatus::Pending | OfferStatus::Accepted)
    {
        MAX_DECK_BYTES
    } else {
        offer.deck_bytes
    }
}

fn is_terminal_status(status: OfferStatus) -> bool {
    matches!(
        status,
        OfferStatus::Completed | OfferStatus::Declined | OfferStatus::Failed
    )
}

fn signature_payload(cid: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(SIGNATURE_DOMAIN.len() + cid.len());
    payload.extend_from_slice(SIGNATURE_DOMAIN);
    payload.extend_from_slice(cid.as_bytes());
    payload
}

fn sanitize_display_name(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_DISPLAY_NAME_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(p2p_error(
            "P2P_INVALID_DISPLAY_NAME",
            "显示名称需为 1 至 48 个有效字符。",
        ));
    }
    Ok(value.to_owned())
}

fn sanitize_remote_display_name(value: &str) -> String {
    sanitize_display_name(value).unwrap_or_else(|_| "匿名锻卡师".to_owned())
}

fn agent_version(display_name: &str) -> String {
    format!(
        "wanxiang-deck/0.1;name={}",
        URL_SAFE_NO_PAD.encode(display_name.as_bytes())
    )
}

fn display_name_from_agent(agent: &str) -> Option<String> {
    let encoded = agent.strip_prefix("wanxiang-deck/0.1;name=")?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok()?;
    let name = String::from_utf8(bytes).ok()?;
    sanitize_display_name(&name).ok()
}

fn peer_id_from_address(address: &Multiaddr) -> Option<PeerId> {
    use libp2p::multiaddr::Protocol;
    address.iter().find_map(|protocol| match protocol {
        Protocol::P2p(peer_id) => Some(peer_id),
        _ => None,
    })
}

fn with_peer_id(mut address: Multiaddr, peer_id: PeerId) -> Multiaddr {
    use libp2p::multiaddr::Protocol;
    if peer_id_from_address(&address).is_none() {
        address.push(Protocol::P2p(peer_id));
    }
    address
}

fn routable_variants(address: &Multiaddr) -> Vec<Multiaddr> {
    let text = address.to_string();
    let mut values = Vec::new();
    if let Some(suffix) = text.strip_prefix("/ip4/0.0.0.0") {
        for interface in if_addrs::get_if_addrs().unwrap_or_default() {
            if let IpAddr::V4(ip) = interface.ip()
                && !ip.is_loopback()
                && let Ok(address) = format!("/ip4/{ip}{suffix}").parse()
            {
                values.push(address);
            }
        }
        if let Ok(loopback) = format!("/ip4/127.0.0.1{suffix}").parse() {
            values.push(loopback);
        }
    } else if let Some(suffix) = text.strip_prefix("/ip6/::") {
        for interface in if_addrs::get_if_addrs().unwrap_or_default() {
            if let IpAddr::V6(ip) = interface.ip()
                && !ip.is_loopback()
                && !ip.is_unspecified()
                && let Ok(address) = format!("/ip6/{ip}{suffix}").parse()
            {
                values.push(address);
            }
        }
    } else {
        values.push(address.clone());
    }
    values
}

fn is_shareable_address(address: &str) -> bool {
    !address.contains("/ip4/0.0.0.0/") && !address.contains("/ip6/::/")
}

fn address_priority(address: &str) -> u8 {
    use libp2p::multiaddr::Protocol;

    let Ok(address) = address.parse::<Multiaddr>() else {
        return 9;
    };
    for protocol in address.iter() {
        match protocol {
            Protocol::Ip6(ip) => {
                return if ip.is_unspecified() {
                    8
                } else if ip.is_loopback() {
                    7
                } else if ip.is_multicast() {
                    6
                } else if ip.is_unicast_link_local() {
                    4
                } else if ip.is_unique_local() {
                    2
                } else {
                    0
                };
            }
            Protocol::Ip4(ip) => {
                return if ip.is_unspecified() {
                    8
                } else if ip.is_loopback() {
                    7
                } else if ip.is_multicast() || ip.is_broadcast() || ip.is_documentation() {
                    6
                } else if ip.is_link_local() {
                    5
                } else if ip.is_private() {
                    3
                } else {
                    1
                };
            }
            _ => {}
        }
    }
    9
}

fn build_connection_code(addresses: &[String]) -> String {
    let mut selected = Vec::new();
    let mut bytes = 0usize;
    for address in addresses
        .iter()
        .filter(|address| is_shareable_address(address))
        .take(12)
    {
        let separator = usize::from(!selected.is_empty());
        if bytes
            .saturating_add(separator)
            .saturating_add(address.len())
            > MAX_CONNECTION_CODE_BYTES
        {
            break;
        }
        bytes += separator + address.len();
        selected.push(address.as_str());
    }
    selected.join("\n")
}

fn valid_timestamp(value: u64) -> u64 {
    let now = now_millis();
    let maximum_skew = 7 * 24 * 60 * 60 * 1000;
    if value.abs_diff(now) <= maximum_skew {
        value
    } else {
        now
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn p2p_error(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message)
}

fn node_not_running() -> CommandError {
    p2p_error("P2P_NOT_RUNNING", "P2P 节点尚未启动。")
}

fn node_stopped() -> CommandError {
    p2p_error("P2P_NODE_STOPPED", "P2P 节点已停止，请重新打开交换站。")
}

fn node_stop_failed() -> CommandError {
    p2p_error(
        "P2P_STOP_FAILED",
        "无法完整停止本机 P2P 节点，请重新启动应用。",
    )
}

fn identity_storage_error() -> CommandError {
    p2p_error("P2P_STORAGE_UNAVAILABLE", "无法读取或保存本机 P2P 身份。")
}

fn offer_journal_read_error() -> CommandError {
    p2p_error(
        "P2P_JOURNAL_READ_FAILED",
        "无法读取本机交换日志，原文件未被覆盖。",
    )
}

fn offer_journal_write_error() -> CommandError {
    p2p_error(
        "P2P_JOURNAL_WRITE_FAILED",
        "无法原子保存本机交换日志，本次交换状态未确认。",
    )
}

fn offer_journal_corrupt_error() -> CommandError {
    p2p_error(
        "P2P_JOURNAL_CORRUPT",
        "本机交换日志损坏或格式无效，原文件未被覆盖。",
    )
}

fn offer_journal_too_large_error() -> CommandError {
    p2p_error(
        "P2P_JOURNAL_TOO_LARGE",
        "本机交换日志超过 50 MiB 上限，原文件未被覆盖。",
    )
}

fn offer_journal_limit_error() -> CommandError {
    p2p_error(
        "P2P_JOURNAL_LIMIT",
        "本机交换日志最多保留 8 条记录，原文件未被覆盖。",
    )
}

fn invalid_signature() -> CommandError {
    p2p_error(
        "P2P_INVALID_SIGNATURE",
        "卡包签名与发送节点不匹配，已拒绝接收。",
    )
}

fn bundle_too_large() -> CommandError {
    p2p_error(
        "P2P_BUNDLE_TOO_LARGE",
        "卡包数据超过 24MB，无法通过点对点交换。",
    )
}

fn remote_rejected(detail: Option<String>) -> CommandError {
    let detail = detail
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .chars()
                .filter(|character| !character.is_control())
                .take(240)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "对方节点拒绝了交换消息。".to_owned());
    p2p_error("P2P_REMOTE_REJECTED", detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn wait_for_snapshot(
        node: &NodeHandle,
        predicate: impl Fn(&P2pSnapshot) -> bool,
    ) -> P2pSnapshot {
        let mut latest = P2pSnapshot::default();
        for _ in 0..200 {
            let snapshot = node.snapshot.read().await.clone();
            if predicate(&snapshot) {
                return snapshot;
            }
            latest = snapshot;
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("timed out waiting for P2P snapshot state: {latest:#?}")
    }

    async fn send_command<T>(
        node: &NodeHandle,
        make_command: impl FnOnce(oneshot::Sender<Result<T, CommandError>>) -> NodeCommand,
    ) -> Result<T, CommandError> {
        let (reply, result) = oneshot::channel();
        node.commands
            .send(make_command(reply))
            .await
            .expect("P2P command channel");
        tokio::time::timeout(Duration::from_secs(10), result)
            .await
            .expect("P2P command timeout")
            .expect("P2P command response")
    }

    fn sample_deck() -> Value {
        json!({
            "id": "deck-1",
            "theme": "星际工坊",
            "name": "星锻试作",
            "modeId": "strategy",
            "story": "在星海中锻造卡牌。",
            "rules": "轮流行动。",
            "cards": [{
                "id": "card-1",
                "name": "星锻师",
                "title": "试作卡",
                "modeId": "strategy",
                "artUrl": "/assets/cards/strategy.jpg",
                "attack": 8,
                "defense": 7,
                "cost": 3,
                "skill": "获得一层护盾。",
                "flavor": "火花会记住每一次锤击。",
                "rarity": "史诗",
                "author": "测试作者"
            }],
            "author": "测试作者"
        })
    }

    fn test_journal_path(label: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("wanxiang-deck-{label}-{}", Uuid::new_v4()));
        let path = root.join("p2p").join(OFFER_JOURNAL_FILE_NAME);
        (root, path)
    }

    fn make_signed_offer(sender: &identity::Keypair, offer_id: String, deck: Value) -> SignedOffer {
        let sender_peer_id = sender.public().to_peer_id();
        SignedOffer {
            offer_id,
            sender_name: "远端锻卡师".to_owned(),
            deck: sign_deck(sender, sender_peer_id, deck).expect("signed offer deck"),
            created_at: now_millis(),
        }
    }

    fn make_outgoing_offer(
        sender: &identity::Keypair,
        remote_peer_id: PeerId,
        offer_id: String,
    ) -> ExchangeOffer {
        let sender_peer_id = sender.public().to_peer_id();
        let signed = sign_deck(sender, sender_peer_id, sample_deck()).expect("signed local deck");
        let deck = deck_with_provenance(&signed);
        ExchangeOffer {
            id: offer_id,
            direction: OfferDirection::Outgoing,
            status: OfferStatus::Pending,
            peer_id: remote_peer_id.to_string(),
            peer_name: "远端锻卡师".to_owned(),
            deck_bytes: encoded_value_size(&deck),
            deck: Arc::new(deck),
            cid: signed.cid,
            signature_valid: true,
            created_at: now_millis(),
        }
    }

    #[test]
    fn offer_journal_restores_verified_history_after_restart() {
        let (root, path) = test_journal_path("p2p-journal-restart");
        let local = identity::Keypair::generate_ed25519();
        let remote = identity::Keypair::generate_ed25519();
        let local_peer_id = local.public().to_peer_id();
        let remote_peer_id = remote.public().to_peer_id();
        let incoming = make_signed_offer(&remote, Uuid::new_v4().to_string(), sample_deck());
        let mut offers = prepare_incoming_offer_history(&[], remote_peer_id, &incoming)
            .expect("verified incoming offer")
            .expect("new history");
        let outgoing_id = Uuid::new_v4().to_string();
        offers.push(make_outgoing_offer(
            &local,
            remote_peer_id,
            outgoing_id.clone(),
        ));

        save_offer_journal_at(&path, local_peer_id, &offers).expect("persist first process");
        let mut journal: OfferJournal =
            serde_json::from_slice(&fs::read(&path).expect("read persisted journal"))
                .expect("parse persisted journal");
        assert!(journal.offers.iter().all(|offer| {
            offer.deck["provenance"]["publicKey"]
                .as_str()
                .is_some_and(|public_key| !public_key.is_empty())
        }));
        assert!(journal.offers.iter().all(|offer| offer.signature_valid));
        for offer in &mut journal.offers {
            offer.signature_valid = false;
        }
        fs::write(
            &path,
            serde_json::to_vec(&journal).expect("encode journal with stale cache"),
        )
        .expect("write journal with stale cache");
        drop(offers);
        let restored = load_offer_journal_at(&path, local_peer_id).expect("restore after restart");

        assert_eq!(restored.len(), 2);
        assert!(restored.iter().all(|offer| offer.signature_valid));
        assert!(restored.iter().any(|offer| {
            offer.id == incoming.offer_id
                && offer.direction == OfferDirection::Incoming
                && offer.status == OfferStatus::Pending
                && offer.cid == incoming.deck.cid
        }));
        assert!(restored.iter().any(|offer| {
            offer.id == outgoing_id
                && offer.direction == OfferDirection::Outgoing
                && offer.status == OfferStatus::Pending
        }));
        assert!(
            restored
                .iter()
                .all(|offer| offer.deck.get("provenance").is_some())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn journal_rejects_content_tampering_even_when_the_cid_is_recomputed() {
        let (root, path) = test_journal_path("p2p-journal-content-tamper");
        let local = identity::Keypair::generate_ed25519();
        let remote_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();
        let local_peer_id = local.public().to_peer_id();
        let offer = make_outgoing_offer(&local, remote_peer_id, Uuid::new_v4().to_string());
        save_offer_journal_at(&path, local_peer_id, &[offer]).expect("persist signed offer");

        let mut journal: OfferJournal =
            serde_json::from_slice(&fs::read(&path).expect("read journal")).expect("parse journal");
        journal.offers[0].deck["name"] = json!("篡改后的套牌");
        let (_, _, recomputed_cid) =
            canonical_deck(journal.offers[0].deck.clone()).expect("recompute tampered content CID");
        journal.offers[0].cid = recomputed_cid.clone();
        journal.offers[0].deck["provenance"]["cid"] = json!(recomputed_cid);
        fs::write(
            &path,
            serde_json::to_vec(&journal).expect("encode tampered journal"),
        )
        .expect("write tampered journal");

        assert_eq!(
            load_offer_journal_at(&path, local_peer_id)
                .expect_err("old signature must not verify the recomputed CID")
                .code,
            "P2P_JOURNAL_CORRUPT"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn journal_rejects_a_public_key_from_another_peer() {
        let (root, path) = test_journal_path("p2p-journal-public-key-tamper");
        let local = identity::Keypair::generate_ed25519();
        let remote_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();
        let replacement = identity::Keypair::generate_ed25519();
        let local_peer_id = local.public().to_peer_id();
        let offer = make_outgoing_offer(&local, remote_peer_id, Uuid::new_v4().to_string());
        save_offer_journal_at(&path, local_peer_id, &[offer]).expect("persist signed offer");

        let mut journal: OfferJournal =
            serde_json::from_slice(&fs::read(&path).expect("read journal")).expect("parse journal");
        journal.offers[0].deck["provenance"]["publicKey"] =
            json!(URL_SAFE_NO_PAD.encode(replacement.public().encode_protobuf()));
        fs::write(
            &path,
            serde_json::to_vec(&journal).expect("encode tampered journal"),
        )
        .expect("write tampered journal");

        assert_eq!(
            load_offer_journal_at(&path, local_peer_id)
                .expect_err("replacement key must be rejected")
                .code,
            "P2P_JOURNAL_CORRUPT"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_journal_without_a_public_key_remains_readable_but_unverified() {
        let (root, path) = test_journal_path("p2p-journal-legacy-provenance");
        let local = identity::Keypair::generate_ed25519();
        let remote_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();
        let local_peer_id = local.public().to_peer_id();
        let offer = make_outgoing_offer(&local, remote_peer_id, Uuid::new_v4().to_string());
        let expected_cid = offer.cid.clone();
        save_offer_journal_at(&path, local_peer_id, &[offer]).expect("persist signed offer");

        let mut journal: OfferJournal =
            serde_json::from_slice(&fs::read(&path).expect("read journal")).expect("parse journal");
        journal.offers[0]
            .deck
            .get_mut("provenance")
            .and_then(Value::as_object_mut)
            .expect("provenance object")
            .remove("publicKey");
        fs::write(
            &path,
            serde_json::to_vec(&journal).expect("encode legacy journal"),
        )
        .expect("write legacy journal");

        let restored = load_offer_journal_at(&path, local_peer_id).expect("load legacy journal");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].cid, expected_cid);
        assert_eq!(restored[0].deck["name"], json!("星锻试作"));
        assert!(!restored[0].signature_valid);

        save_offer_journal_at(&path, local_peer_id, &restored)
            .expect("re-save unverified legacy journal");
        let rewritten: OfferJournal =
            serde_json::from_slice(&fs::read(&path).expect("read rewritten journal"))
                .expect("parse rewritten journal");
        assert!(!rewritten.offers[0].signature_valid);
        assert!(
            rewritten.offers[0].deck["provenance"]
                .get("publicKey")
                .is_none()
        );
        let reloaded = load_offer_journal_at(&path, local_peer_id).expect("reload legacy journal");
        assert!(!reloaded[0].signature_valid);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn repeated_offer_and_decision_are_idempotent_but_conflicts_are_rejected() {
        let local = identity::Keypair::generate_ed25519();
        let remote = identity::Keypair::generate_ed25519();
        let local_peer_id = local.public().to_peer_id();
        let remote_peer_id = remote.public().to_peer_id();
        let offer_id = Uuid::new_v4().to_string();
        let incoming = make_signed_offer(&remote, offer_id.clone(), sample_deck());
        let history = prepare_incoming_offer_history(&[], remote_peer_id, &incoming)
            .expect("first offer")
            .expect("new offer");

        assert!(
            prepare_incoming_offer_history(&history, remote_peer_id, &incoming)
                .expect("same signed offer is idempotent")
                .is_none()
        );
        assert_eq!(history.len(), 1);

        let mut changed_deck = sample_deck();
        changed_deck["name"] = json!("复用请求号的不同卡包");
        let conflicting = make_signed_offer(&remote, offer_id, changed_deck);
        assert_eq!(
            prepare_incoming_offer_history(&history, remote_peer_id, &conflicting)
                .expect_err("same ID with another CID must fail")
                .code,
            "P2P_OFFER_CONFLICT"
        );

        let outgoing_id = Uuid::new_v4().to_string();
        let outgoing = make_outgoing_offer(&local, remote_peer_id, outgoing_id.clone());
        let mut counter_deck = sample_deck();
        counter_deck["name"] = json!("远端回赠卡包");
        let counter = sign_deck(&remote, remote_peer_id, counter_deck).expect("signed counter");
        let decision = SignedDecision {
            offer_id: outgoing_id,
            sender_name: "远端锻卡师".to_owned(),
            accept: true,
            counter_deck: Some(counter),
            created_at: now_millis(),
        };
        let completed = prepare_incoming_decision_history(&[outgoing], remote_peer_id, &decision)
            .expect("first decision")
            .expect("completed history");
        assert!(
            prepare_incoming_decision_history(&completed, remote_peer_id, &decision)
                .expect("same decision is idempotent")
                .is_none()
        );
        assert_eq!(completed[0].status, OfferStatus::Completed);
        assert_eq!(
            completed[0].deck["provenance"]["signerPeerId"],
            json!(remote_peer_id.to_string())
        );
        assert_ne!(local_peer_id, remote_peer_id);
    }

    #[test]
    fn accepted_incoming_offer_recovers_as_pending_and_retry_stays_idempotent() {
        let (root, path) = test_journal_path("p2p-journal-accepted-recovery");
        let local = identity::Keypair::generate_ed25519();
        let remote = identity::Keypair::generate_ed25519();
        let local_peer_id = local.public().to_peer_id();
        let remote_peer_id = remote.public().to_peer_id();
        let offer_id = Uuid::new_v4().to_string();
        let incoming = make_signed_offer(&remote, offer_id.clone(), sample_deck());
        let mut local_history = prepare_incoming_offer_history(&[], remote_peer_id, &incoming)
            .expect("receive offer")
            .expect("new incoming offer");
        local_history[0].status = OfferStatus::Accepted;
        save_offer_journal_at(&path, local_peer_id, &local_history)
            .expect("persist pre-send accepted state");

        let restored = load_offer_journal_at(&path, local_peer_id).expect("recover after crash");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].direction, OfferDirection::Incoming);
        assert_eq!(restored[0].status, OfferStatus::Pending);
        assert_eq!(restored[0].id, offer_id);

        let remote_outgoing = make_outgoing_offer(&remote, local_peer_id, offer_id.clone());
        let mut counter_deck = sample_deck();
        counter_deck["name"] = json!("本机回赠卡包");
        let counter = sign_deck(&local, local_peer_id, counter_deck).expect("signed counter deck");
        let retry_decision = SignedDecision {
            offer_id,
            sender_name: "本机锻卡师".to_owned(),
            accept: true,
            counter_deck: Some(counter),
            created_at: now_millis(),
        };
        let remote_completed =
            prepare_incoming_decision_history(&[remote_outgoing], local_peer_id, &retry_decision)
                .expect("remote handles first delivered decision")
                .expect("remote completes offer");
        assert_eq!(remote_completed[0].status, OfferStatus::Completed);
        assert!(
            prepare_incoming_decision_history(&remote_completed, local_peer_id, &retry_decision,)
                .expect("retry after local crash is valid")
                .is_none()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unresolved_incoming_offers_are_limited_per_peer() {
        let first_peer = identity::Keypair::generate_ed25519();
        let second_peer = identity::Keypair::generate_ed25519();
        let first_peer_id = first_peer.public().to_peer_id();
        let second_peer_id = second_peer.public().to_peer_id();
        let first = make_signed_offer(&first_peer, Uuid::new_v4().to_string(), sample_deck());
        let second = make_signed_offer(&first_peer, Uuid::new_v4().to_string(), sample_deck());
        let third = make_signed_offer(&first_peer, Uuid::new_v4().to_string(), sample_deck());
        let another_peer =
            make_signed_offer(&second_peer, Uuid::new_v4().to_string(), sample_deck());

        let mut history = prepare_incoming_offer_history(&[], first_peer_id, &first)
            .expect("first offer")
            .expect("first offer is new");
        history[0].status = OfferStatus::Accepted;
        history = prepare_incoming_offer_history(&history, first_peer_id, &second)
            .expect("second offer")
            .expect("second offer is new");

        assert!(
            prepare_incoming_offer_history(&history, first_peer_id, &first)
                .expect("duplicate resend remains idempotent at the limit")
                .is_none()
        );
        assert_eq!(
            prepare_incoming_offer_history(&history, first_peer_id, &third)
                .expect_err("third unresolved offer from the same peer is rejected")
                .code,
            "P2P_PEER_PENDING_LIMIT"
        );

        history = prepare_incoming_offer_history(&history, second_peer_id, &another_peer)
            .expect("another peer has an independent allowance")
            .expect("another peer offer is new");
        let completed_index = history
            .iter()
            .position(|offer| offer.id == first.offer_id)
            .expect("first offer retained");
        history[completed_index].status = OfferStatus::Completed;
        let with_third = prepare_incoming_offer_history(&history, first_peer_id, &third)
            .expect("terminal records do not consume the per-peer allowance")
            .expect("third offer becomes admissible");
        assert!(with_third.iter().any(|offer| offer.id == third.offer_id));
    }

    #[test]
    fn corrupt_journal_is_reported_and_never_overwritten() {
        let (root, path) = test_journal_path("p2p-journal-corrupt");
        fs::create_dir_all(path.parent().expect("journal parent")).expect("create journal parent");
        let original = b"{not-valid-json";
        fs::write(&path, original).expect("write corrupt journal");
        let local_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();

        assert_eq!(
            load_offer_journal_at(&path, local_peer_id)
                .expect_err("corrupt journal rejected")
                .code,
            "P2P_JOURNAL_CORRUPT"
        );
        assert_eq!(
            save_offer_journal_at(&path, local_peer_id, &[])
                .expect_err("save must not replace corrupt journal")
                .code,
            "P2P_JOURNAL_CORRUPT"
        );
        assert_eq!(fs::read(&path).expect("read preserved journal"), original);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_journal_is_rejected_without_reading_or_replacing_it() {
        let (root, path) = test_journal_path("p2p-journal-oversized");
        fs::create_dir_all(path.parent().expect("journal parent")).expect("create journal parent");
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("create oversized journal");
        file.set_len(MAX_OFFER_JOURNAL_BYTES as u64 + 1)
            .expect("size sparse journal");
        drop(file);
        let local_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();

        assert_eq!(
            load_offer_journal_at(&path, local_peer_id)
                .expect_err("oversized journal rejected")
                .code,
            "P2P_JOURNAL_TOO_LARGE"
        );
        assert_eq!(
            save_offer_journal_at(&path, local_peer_id, &[])
                .expect_err("save must not replace oversized journal")
                .code,
            "P2P_JOURNAL_TOO_LARGE"
        );
        assert_eq!(
            fs::metadata(&path).expect("journal metadata").len(),
            MAX_OFFER_JOURNAL_BYTES as u64 + 1
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn journal_rejects_more_than_eight_records() {
        let (root, path) = test_journal_path("p2p-journal-count");
        fs::create_dir_all(path.parent().expect("journal parent")).expect("create journal parent");
        let local = identity::Keypair::generate_ed25519();
        let remote = identity::Keypair::generate_ed25519();
        let local_peer_id = local.public().to_peer_id();
        let remote_peer_id = remote.public().to_peer_id();
        let template = persisted_offer(&make_outgoing_offer(
            &local,
            remote_peer_id,
            Uuid::new_v4().to_string(),
        ));
        let offers = (0..=MAX_OFFERS)
            .map(|_| {
                let mut offer = template.clone();
                offer.id = Uuid::new_v4().to_string();
                offer
            })
            .collect();
        let journal = OfferJournal {
            schema_version: OFFER_JOURNAL_SCHEMA_VERSION,
            local_peer_id: local_peer_id.to_string(),
            offers,
        };
        fs::write(&path, serde_json::to_vec(&journal).expect("encode journal"))
            .expect("write over-count journal");

        assert_eq!(
            load_offer_journal_at(&path, local_peer_id)
                .expect_err("over-count journal rejected")
                .code,
            "P2P_JOURNAL_LIMIT"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fan_study_decks_are_local_only_at_the_rust_boundary() {
        let mut deck = sample_deck();
        deck["contentPolicy"] = json!({
            "schemaVersion": 1,
            "mode": "fan-study",
            "agreement": {
                "termsVersion": "1.0",
                "acceptedAt": 1_800_000_000_000_u64,
                "confirmations": {
                    "materialsRightsConfirmed": true,
                    "personalNonCommercialConfirmed": true,
                    "unofficialAndUnaffiliatedConfirmed": true,
                    "guardianJointlyConfirmed": true
                }
            }
        });
        let error = validate_deck(&deck).expect_err("fan-study deck must not enter P2P");
        assert_eq!(error.code, "P2P_FAN_STUDY_LOCAL_ONLY");
    }

    #[test]
    fn explicit_original_policy_remains_exchangeable() {
        let mut deck = sample_deck();
        deck["contentPolicy"] = json!({ "schemaVersion": 1, "mode": "original" });
        validate_deck(&deck).expect("original deck can enter P2P");
    }

    #[test]
    fn ai_generated_cards_can_enter_p2p_immediately() {
        let mut deck = sample_deck();
        deck["cards"][0]["id"] = json!("ai-card-1");
        validate_deck(&deck).expect("generated cards are immediately exchangeable");
    }

    fn sample_offer(
        id: impl Into<String>,
        direction: OfferDirection,
        status: OfferStatus,
        deck_bytes: usize,
    ) -> ExchangeOffer {
        ExchangeOffer {
            id: id.into(),
            direction,
            status,
            peer_id: "test-peer".to_owned(),
            peer_name: "测试节点".to_owned(),
            deck: Arc::new(sample_deck()),
            cid: "blake3:test".to_owned(),
            signature_valid: true,
            created_at: 0,
            deck_bytes,
        }
    }

    fn large_webp_data_url() -> String {
        let mut bytes = vec![0_u8; 786_432];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WEBP");
        format!("data:image/webp;base64,{}", BASE64.encode(bytes))
    }

    #[test]
    fn accepts_current_and_legacy_builtin_artwork_paths() {
        validate_art_url("/assets/cards/starter/memory-2.jpg").expect("current starter art");
        validate_art_url("/assets/cards/starter/memory-2.webp").expect("legacy starter art");

        for invalid in [
            "/assets/cards/starter/memory-5.jpg",
            "/assets/cards/starter/../memory.jpg",
        ] {
            assert_eq!(
                validate_art_url(invalid)
                    .expect_err("unlisted path rejected")
                    .code,
                "P2P_INVALID_DECK"
            );
        }
    }

    #[test]
    fn signs_and_verifies_a_deck_against_transport_identity() {
        let keypair = identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let signed = sign_deck(&keypair, peer_id, sample_deck()).expect("signed deck");
        let verified = verify_deck(&signed, peer_id).expect("verified deck");
        let provenance = verified
            .get("provenance")
            .and_then(Value::as_object)
            .expect("provenance");
        assert_eq!(provenance.get("cid"), Some(&Value::String(signed.cid)));
        assert_eq!(
            provenance.get("signerPeerId"),
            Some(&Value::String(peer_id.to_string()))
        );
    }

    #[test]
    fn rejects_tampered_deck_content() {
        let keypair = identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let mut signed = sign_deck(&keypair, peer_id, sample_deck()).expect("signed deck");
        signed.deck["name"] = Value::String("被篡改".to_owned());
        assert_eq!(
            verify_deck(&signed, peer_id)
                .expect_err("tampering rejected")
                .code,
            "P2P_HASH_MISMATCH"
        );
    }

    #[test]
    fn signs_revision_metadata_and_rejects_revision_tampering() {
        let keypair = identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let mut deck = sample_deck();
        deck["revision"] = json!({
            "familyId": "deck-family-1",
            "revision": 3,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "card-regeneration"
        });
        let mut signed = sign_deck(&keypair, peer_id, deck).expect("signed revision");
        let verified = verify_deck(&signed, peer_id).expect("verified revision");
        assert_eq!(verified["revision"]["revision"], json!(3));

        signed.deck["revision"]["revision"] = json!(4);
        assert_eq!(
            verify_deck(&signed, peer_id)
                .expect_err("revision tampering rejected")
                .code,
            "P2P_HASH_MISMATCH"
        );
    }

    #[test]
    fn rejects_a_signature_from_another_peer() {
        let signer = identity::Keypair::generate_ed25519();
        let receiver_view = identity::Keypair::generate_ed25519().public().to_peer_id();
        let signed =
            sign_deck(&signer, signer.public().to_peer_id(), sample_deck()).expect("signed deck");
        assert_eq!(
            verify_deck(&signed, receiver_view)
                .expect_err("wrong transport peer rejected")
                .code,
            "P2P_INVALID_SIGNATURE"
        );
    }

    #[test]
    fn canonical_hash_ignores_prior_provenance() {
        let deck = sample_deck();
        let (_, _, first) = canonical_deck(deck.clone()).expect("first hash");
        let mut with_provenance = deck;
        with_provenance["provenance"] = json!({
            "cid": "old",
            "signerPeerId": "old",
            "signature": "old"
        });
        let (_, _, second) = canonical_deck(with_provenance).expect("second hash");
        assert_eq!(first, second);
    }

    #[test]
    fn same_deck_id_with_changed_content_produces_a_distinct_verified_cid() {
        let keypair = identity::Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        let first = sign_deck(&keypair, peer_id, sample_deck()).expect("first version");
        let mut changed = sample_deck();
        changed["story"] = json!("在星海中锻造卡牌，并守护新生的星门。");
        let second = sign_deck(&keypair, peer_id, changed).expect("second version");

        assert_eq!(first.deck["id"], second.deck["id"]);
        assert_ne!(first.cid, second.cid);
        for signed in [&first, &second] {
            let verified = verify_deck(signed, peer_id).expect("verified version");
            assert_eq!(verified["id"], json!("deck-1"));
            assert_eq!(verified["provenance"]["cid"], json!(signed.cid));
        }
    }

    #[test]
    fn rejects_invalid_deck_shape() {
        let mut deck = sample_deck();
        deck["cards"][0]["attack"] = Value::from(-1);
        assert_eq!(
            validate_deck(&deck).expect_err("invalid attack").code,
            "P2P_INVALID_DECK"
        );

        let mut invalid_revision = sample_deck();
        invalid_revision["revision"] = json!({
            "familyId": "deck-family-1",
            "revision": 2,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "unknown",
        });
        assert_eq!(
            validate_deck(&invalid_revision)
                .expect_err("invalid revision rejected")
                .code,
            "P2P_INVALID_DECK"
        );

        invalid_revision["revision"]["reason"] = json!("deck-generation");
        invalid_revision["revision"]["unexpected"] = json!(true);
        assert_eq!(
            validate_deck(&invalid_revision)
                .expect_err("extended revision rejected")
                .code,
            "P2P_INVALID_DECK"
        );

        let mut invalid_gameplay = sample_deck();
        invalid_gameplay["cards"][0]["gameplay"] = json!([{
            "kind": "memory",
            "pairId": "p1",
            "pairRole": "c"
        }]);
        assert_eq!(
            validate_deck(&invalid_gameplay)
                .expect_err("invalid gameplay binding rejected")
                .code,
            "P2P_INVALID_DECK"
        );

        let mut unsafe_gameplay = sample_deck();
        unsafe_gameplay["cards"][0]["gameplay"] = json!([{
            "kind": "custom",
            "moduleId": "maker-module",
            "slotRole": "血腥屠杀机关"
        }]);
        assert_eq!(
            validate_deck(&unsafe_gameplay)
                .expect_err("unsafe gameplay text rejected")
                .code,
            "P2P_UNSAFE_DECK"
        );
    }

    #[test]
    fn validates_rule_kit_creator_plaque_and_inscription() {
        let mut deck = sample_deck();
        deck["artStyleId"] = json!("dunhuang-mineral");
        deck["cards"][0]["inscriptionText"] = json!("万象");
        deck["ruleKit"] = json!({
            "schemaVersion": 1,
            "title": "星锻协作规则",
            "playerRange": { "min": 2, "max": 6 },
            "durationMinutes": { "min": 15, "max": 30 },
            "ageFrom": 8,
            "teamMode": false,
            "components": ["星纹牌", "回合标记"],
            "modules": [{
                "id": "quantity-trigger-1",
                "source": "template",
                "templateId": "quantity-trigger",
                "name": "衡数鸣台",
                "summary": "累计公开标记并触发结算。",
                "glyph": "衡",
                "accentHex": "#d39032",
                "tags": ["数量", "观察"],
                "enabled": true,
                "parameters": [{
                    "id": "targetTotal",
                    "label": "目标数量",
                    "control": "stepper",
                    "value": 5,
                    "min": 2,
                    "max": 12,
                    "step": 1
                }],
                "content": {
                    "objective": ["先完成目标。"],
                    "setup": ["摆好卡牌。"],
                    "flow": ["依次出牌并计算标记。"],
                    "victory": ["得分最高者获胜。"],
                    "variants": []
                }
            }],
            "victory": { "mode": "module-default" },
            "customNotes": []
        });
        deck["creatorPlaque"] = json!({
            "displayName": "测试作者",
            "signatureText": "星锻",
            "sealText": "万象"
        });

        validate_deck(&deck).expect("extended deck is valid");

        deck["ruleKit"]["modules"][0]["unexpected"] = json!(true);
        assert_eq!(
            validate_deck(&deck)
                .expect_err("unknown nested field rejected")
                .code,
            "P2P_INVALID_DECK"
        );
    }

    #[test]
    fn rejects_unsafe_card_inscription() {
        let mut deck = sample_deck();
        deck["cards"][0]["inscriptionText"] = json!("血腥屠杀");
        assert_eq!(
            validate_deck(&deck)
                .expect_err("unsafe inscription rejected")
                .code,
            "P2P_UNSAFE_DECK"
        );
    }

    #[test]
    fn display_name_round_trips_through_identify_agent() {
        let name = "万象学徒";
        assert_eq!(
            display_name_from_agent(&agent_version(name)).as_deref(),
            Some(name)
        );
    }

    #[test]
    fn capacity_pressure_never_evicts_active_offers() {
        let mut offers = (0..MAX_OFFERS)
            .map(|index| {
                sample_offer(
                    format!("pending-{index}"),
                    OfferDirection::Incoming,
                    OfferStatus::Pending,
                    1,
                )
            })
            .collect::<Vec<_>>();
        let active_ids = offers
            .iter()
            .map(|offer| offer.id.clone())
            .collect::<Vec<_>>();

        let error = reserve_offer_capacity(&mut offers, 1).expect_err("active history is full");
        assert_eq!(error.code, "P2P_NODE_BUSY");
        assert_eq!(
            offers
                .iter()
                .map(|offer| offer.id.clone())
                .collect::<Vec<_>>(),
            active_ids
        );

        offers[MAX_OFFERS - 1].status = OfferStatus::Completed;
        let completed_id = offers[MAX_OFFERS - 1].id.clone();
        reserve_offer_capacity(&mut offers, 1).expect("terminal offer can be evicted");
        assert_eq!(offers.len(), MAX_OFFERS - 1);
        assert!(!offers.iter().any(|offer| offer.id == completed_id));
        assert!(
            offers
                .iter()
                .all(|offer| matches!(offer.status, OfferStatus::Pending))
        );

        let mut byte_saturated = vec![
            sample_offer(
                "outgoing-a",
                OfferDirection::Outgoing,
                OfferStatus::Pending,
                1,
            ),
            sample_offer(
                "outgoing-b",
                OfferDirection::Outgoing,
                OfferStatus::Pending,
                1,
            ),
        ];
        let error = reserve_offer_capacity(&mut byte_saturated, 1)
            .expect_err("active byte reservations are full");
        assert_eq!(error.code, "P2P_NODE_BUSY");
        assert_eq!(byte_saturated.len(), 2);
        assert!(
            byte_saturated
                .iter()
                .all(|offer| matches!(offer.status, OfferStatus::Pending))
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn repeated_start_and_stop_preserve_identity_and_offer_journal() {
        let test_root =
            std::env::temp_dir().join(format!("wanxiang-deck-p2p-lifecycle-{}", Uuid::new_v4()));
        let p2p_directory = test_root.join("p2p");
        let identity_path = p2p_directory.join("identity.key");
        let journal_path = p2p_directory.join(OFFER_JOURNAL_FILE_NAME);
        let local = load_or_create_identity(&identity_path).expect("create persistent identity");
        let local_peer_id = local.public().to_peer_id();
        let remote_peer_id = identity::Keypair::generate_ed25519().public().to_peer_id();
        let offer = make_outgoing_offer(&local, remote_peer_id, Uuid::new_v4().to_string());
        let expected_offer_id = offer.id.clone();
        save_offer_journal_at(&journal_path, local_peer_id, &[offer])
            .expect("seed persistent offer journal");
        let identity_before = fs::read(&identity_path).expect("read identity before lifecycle");
        let journal_before = fs::read(&journal_path).expect("read journal before lifecycle");
        let state = P2pState::default();

        let first = start_p2p_at(&state, test_root.clone(), "甲方".to_owned())
            .await
            .expect("first start");
        let first_lease = first.lease_id.expect("first starter owns lease");
        let repeated = start_p2p_at(&state, test_root.clone(), "不应替换名称".to_owned())
            .await
            .expect("idempotent repeated start");
        assert!(first.snapshot.running);
        assert!(repeated.snapshot.running);
        assert!(repeated.lease_id.is_none());
        assert_eq!(
            repeated
                .snapshot
                .identity
                .as_ref()
                .map(|identity| identity.peer_id.as_str()),
            Some(local_peer_id.to_string().as_str())
        );
        assert_eq!(
            repeated
                .snapshot
                .identity
                .as_ref()
                .map(|identity| identity.display_name.as_str()),
            Some("甲方")
        );
        assert_eq!(repeated.snapshot.offers.len(), 1);

        let wrong_lease = Uuid::new_v4();
        let still_running = stop_p2p_state(&state, Some(wrong_lease))
            .await
            .expect("foreign lease is a no-op");
        assert!(still_running.running);
        assert!(state.node.lock().await.is_some());

        let stopped = stop_p2p_state(&state, Some(first_lease))
            .await
            .expect("owner stop");
        assert!(!stopped.running);
        assert!(stopped.peers.is_empty());
        assert_eq!(stopped.offers.len(), 1);
        assert_eq!(stopped.offers[0].id, expected_offer_id);
        let stopped_identity = stopped.identity.as_ref().expect("stopped identity");
        assert_eq!(stopped_identity.peer_id, local_peer_id.to_string());
        assert!(stopped_identity.connection_code.is_empty());
        assert!(stopped_identity.listen_addresses.is_empty());
        assert!(state.node.lock().await.is_none());

        let stopped_again = stop_p2p_state(&state, Some(first_lease))
            .await
            .expect("idempotent repeated stop");
        assert!(!stopped_again.running);
        assert_eq!(stopped_again.offers.len(), 1);
        assert_eq!(
            fs::read(&identity_path).expect("identity survives stop"),
            identity_before
        );
        assert_eq!(
            fs::read(&journal_path).expect("journal survives stop"),
            journal_before
        );

        let restarted = start_p2p_at(&state, test_root.clone(), "甲方重启".to_owned())
            .await
            .expect("restart after stop");
        let restarted_lease = restarted.lease_id.expect("restart owns a new lease");
        assert_ne!(restarted_lease, first_lease);
        assert_eq!(
            restarted
                .snapshot
                .identity
                .as_ref()
                .map(|identity| identity.peer_id.as_str()),
            Some(local_peer_id.to_string().as_str())
        );
        assert_eq!(restarted.snapshot.offers.len(), 1);
        assert_eq!(restarted.snapshot.offers[0].id, expected_offer_id);

        let stale_stop = stop_p2p_state(&state, Some(first_lease))
            .await
            .expect("old lease cannot stop restarted node");
        assert!(stale_stop.running);
        assert!(state.node.lock().await.is_some());
        stop_p2p_state(&state, Some(restarted_lease))
            .await
            .expect("final owner stop");

        let _ = fs::remove_dir_all(test_root);
    }

    #[test]
    fn malformed_node_lease_is_rejected() {
        assert!(parse_lease_id(None).expect("force-stop lease").is_none());
        let lease = Uuid::new_v4();
        assert_eq!(
            parse_lease_id(Some(lease.to_string())).expect("valid lease"),
            Some(lease)
        );
        assert_eq!(
            parse_lease_id(Some("not-a-uuid".to_owned()))
                .expect_err("malformed lease rejected")
                .code,
            "P2P_INVALID_LEASE"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_quic_nodes_complete_a_signed_exchange() {
        let test_root = std::env::temp_dir().join(format!("wanxiang-deck-p2p-{}", Uuid::new_v4()));
        let node_a = NodeHandle::start(test_root.join("a"), "甲方".to_owned())
            .await
            .expect("node A");
        let node_b = NodeHandle::start(test_root.join("b"), "乙方".to_owned())
            .await
            .expect("node B");

        let snapshot_a = wait_for_snapshot(&node_a, |snapshot| {
            snapshot
                .identity
                .as_ref()
                .is_some_and(|identity| !identity.connection_code.is_empty())
        })
        .await;
        let snapshot_b = wait_for_snapshot(&node_b, |snapshot| {
            snapshot
                .identity
                .as_ref()
                .is_some_and(|identity| !identity.connection_code.is_empty())
        })
        .await;
        let identity_a = snapshot_a.identity.expect("identity A");
        let identity_b = snapshot_b.identity.expect("identity B");

        send_command(&node_a, |reply| NodeCommand::Connect {
            connection_code: identity_b.connection_code,
            reply,
        })
        .await
        .expect("connect A to B");
        wait_for_snapshot(&node_a, |snapshot| {
            snapshot
                .peers
                .iter()
                .any(|peer| peer.peer_id == identity_b.peer_id && peer.connected && peer.verified)
        })
        .await;
        wait_for_snapshot(&node_b, |snapshot| {
            snapshot
                .peers
                .iter()
                .any(|peer| peer.peer_id == identity_a.peer_id && peer.connected && peer.verified)
        })
        .await;

        let peer_b = identity_b.peer_id.parse::<PeerId>().expect("peer B");
        let mut offered_deck = sample_deck();
        offered_deck["name"] = Value::String("甲方卡包".to_owned());
        offered_deck["cards"][0]["artUrl"] = Value::String(large_webp_data_url());
        assert!(
            serde_json::to_vec(&offered_deck)
                .expect("large deck JSON")
                .len()
                > 1024 * 1024
        );
        let offer_id = send_command(&node_a, |reply| NodeCommand::SendOffer {
            peer_id: peer_b,
            deck: offered_deck,
            reply,
        })
        .await
        .expect("send offer");
        wait_for_snapshot(&node_b, |snapshot| {
            snapshot.offers.iter().any(|offer| {
                offer.id == offer_id
                    && matches!(offer.direction, OfferDirection::Incoming)
                    && matches!(offer.status, OfferStatus::Pending)
                    && offer.signature_valid
            })
        })
        .await;

        let mut counter_deck = sample_deck();
        counter_deck["name"] = Value::String("乙方卡包".to_owned());
        send_command(&node_b, |reply| NodeCommand::RespondOffer {
            offer_id: offer_id.clone(),
            accept: true,
            counter_deck: Some(counter_deck),
            reply,
        })
        .await
        .expect("accept offer");

        let completed_a = wait_for_snapshot(&node_a, |snapshot| {
            snapshot.offers.iter().any(|offer| {
                offer.id == offer_id
                    && matches!(offer.direction, OfferDirection::Outgoing)
                    && matches!(offer.status, OfferStatus::Completed)
                    && offer.signature_valid
            })
        })
        .await;
        let received = completed_a
            .offers
            .iter()
            .find(|offer| offer.id == offer_id)
            .expect("completed offer");
        assert_eq!(
            received.deck.get("name").and_then(Value::as_str),
            Some("乙方卡包")
        );
        assert!(received.deck.get("provenance").is_some());

        wait_for_snapshot(&node_b, |snapshot| {
            snapshot.offers.iter().any(|offer| {
                offer.id == offer_id
                    && matches!(offer.direction, OfferDirection::Incoming)
                    && matches!(offer.status, OfferStatus::Completed)
            })
        })
        .await;

        node_a.stop().await.expect("stop node A");
        node_b.stop().await.expect("stop node B");
        let _ = fs::remove_dir_all(test_root);
    }
}
