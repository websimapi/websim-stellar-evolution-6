const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;
const { createRoot } = ReactDOM;

// Connect to websocket for multiplayer
const room = new WebsimSocket();

// Initialize game state
const initialGameState = {
  resources: {
    energy: 500,
    minerals: 300,
    knowledge: 100,
    population: 1e9
  },
  starSystems: [
    {
      id: "sol-system",
      name: "Sol System",
      explored: true,
      bodies: [
        { id: "mercury", name: "Mercury", type: "PLANET", explored: true, habitable: false },
        { id: "venus", name: "Venus", type: "PLANET", explored: true, habitable: false },
        { id: "earth", name: "Earth", type: "PLANET", explored: true, habitable: true, population: 1e9 },
        { id: "mars", name: "Mars", type: "PLANET", explored: true, habitable: false },
        { id: "asteroid-belt", name: "Asteroid Belt", type: "ASTEROID_FIELD", explored: false },
        { id: "jupiter", name: "Jupiter", type: "GAS_GIANT", explored: false },
        { id: "saturn", name: "Saturn", type: "GAS_GIANT", explored: false },
        { id: "uranus", name: "Uranus", type: "GAS_GIANT", explored: false },
        { id: "neptune", name: "Neptune", type: "GAS_GIANT", explored: false }
      ]
    }
  ],
  colonies: [
    {
      id: "earth-colony",
      planetId: "earth",
      name: "Earth",
      population: 1e9,
      facilities: [
        { id: "research-lab-1", type: "RESEARCH_LAB", level: 1 },
        { id: "power-plant-1", type: "POWER_PLANT", level: 1 },
        { id: "mining-facility-1", type: "MINING_FACILITY", level: 1 }
      ]
    }
  ],
  technologies: [
    { id: "basic-agriculture", name: "Basic Agriculture", completed: true },
    { id: "basic-construction", name: "Basic Construction", completed: true },
    { id: "basic-energy", name: "Basic Energy Production", completed: true },
    { id: "solar-power", name: "Solar Power", completed: false, progress: 0, required: 100 },
    { id: "nuclear-fission", name: "Nuclear Fission", completed: false, progress: 0, required: 250 },
    { id: "space-flight", name: "Space Flight", completed: false, progress: 0, required: 300 },
    { id: "advanced-materials", name: "Advanced Materials", completed: false, progress: 0, required: 400 }
  ],
  events: [],
  turn: 1,
  turnStartTime: Date.now(),
  commandHistory: [],
  lastCommand: null,
  discoveryQueue: []
};

// Game state persistence helper functions
const loadGameState = () => {
  try {
    const savedState = localStorage.getItem('stellarEvolutionState');
    return savedState ? JSON.parse(savedState) : null;
  } catch (error) {
    console.error('Error loading game state:', error);
    return null;
  }
};

const saveGameState = (gameState) => {
  try {
    localStorage.setItem('stellarEvolutionState', JSON.stringify(gameState));
  } catch (error) {
    console.error('Error saving game state:', error);
  }
};

// Main game component
function Game() {
  // Game state using React state
  const [gameState, setGameState] = useState(() => loadGameState() || initialGameState);
  const [command, setCommand] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputMessages, setOutputMessages] = useState([
    {
      id: "welcome",
      timestamp: Date.now(),
      type: "system",
      text: "Welcome to Stellar Evolution. Your civilization is in its early stages of development. What would you like to do?",
      details: "You can try commands like 'explore asteroid belt', 'research solar power', or 'build mining facility'."
    }
  ]);
  
  const outputRef = useRef(null);
  
  // Multiplayer state from WebsimSocket
  const peers = useSyncExternalStore(
    room.party.subscribe,
    () => room.party.peers
  );
  
  // Track connected players
  useEffect(() => {
    // When peers change, add a system message
    const peerCount = Object.keys(peers).length;
    if (peerCount > 1) {
      addSystemMessage(`${peerCount} civilizations now exist in this universe.`);
    }
  }, [peers]);
  
  // Sync game state with other players
  useEffect(() => {
    room.onmessage = (event) => {
      const data = event.data;
      
      if (data.type === "gameState") {
        // Merge the received state with our local state
        setGameState(prevState => ({
          ...prevState,
          ...data.state
        }));
        
        // If there's a narrative, add it to the output messages
        if (data.narrative) {
          addOutputMessage(
            data.narrative.tone || "system",
            data.narrative.mainText,
            data.narrative.detailText,
            data.narrative.imageUrl
          );
        }
      }
      
      if (data.type === "command") {
        // Another player submitted a command
        addSystemMessage(`${data.username}'s civilization: "${data.command}"`);
      }
    };
    
    // Cleanup
    return () => {
      room.onmessage = null;
    };
  }, []);
  
  // Load game state from server or local storage
  useEffect(() => {
    // Try to load state from persistent storage
    const messages = room.collection('gameMessages').getList();
    if (messages.length > 0) {
      // Convert stored messages to our format
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        timestamp: new Date(msg.created_at).getTime(),
        type: msg.messageType,
        text: msg.text,
        details: msg.details,
        imageUrl: msg.imageUrl
      }));
      
      // Add them to our messages, keeping the welcome message at the top
      setOutputMessages(prev => [prev[0], ...formattedMessages]);
    }
    
    // Try to get stored game state
    const gameStateRecords = room.collection('gameState').getList();
    if (gameStateRecords.length > 0) {
      // Use the latest state
      const latestState = gameStateRecords[0];
      if (latestState.state) {
        setGameState(JSON.parse(latestState.state));
      }
    }
    
    // Subscribe to future changes
    const unsubscribeMessages = room.collection('gameMessages').subscribe(messages => {
      if (messages.length > 0) {
        // Update our messages when new ones arrive
        const formattedMessages = messages.map(msg => ({
          id: msg.id,
          timestamp: new Date(msg.created_at).getTime(),
          type: msg.messageType,
          text: msg.text,
          details: msg.details,
          imageUrl: msg.imageUrl
        }));
        
        setOutputMessages(prev => {
          // Keep welcome message and add new ones without duplicates
          const welcomeMessage = prev.find(m => m.id === "welcome") || prev[0];
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = formattedMessages.filter(m => !existingIds.has(m.id));
          
          return [welcomeMessage, ...newMessages, ...prev.slice(1)];
        });
      }
    });
    
    return () => {
      unsubscribeMessages();
    };
  }, []);
  
  // Auto-scroll to bottom of output when messages change
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputMessages]);
  
  // Save game state when it changes
  useEffect(() => {
    saveGameState(gameState);
    
    // Also save to database for multiplayer
    const saveToDatabase = async () => {
      const existingStates = room.collection('gameState').getList();
      
      if (existingStates.length > 0) {
        // Update existing state
        await room.collection('gameState').update(existingStates[0].id, {
          state: JSON.stringify(gameState)
        });
      } else {
        // Create new state record
        await room.collection('gameState').create({
          state: JSON.stringify(gameState)
        });
      }
    };
    
    saveToDatabase().catch(console.error);
  }, [gameState]);
  
  // Add a message to the output area
  const addOutputMessage = useCallback(async (type, text, details = null, imageUrl = null) => {
    const newMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type,
      text,
      details,
      imageUrl
    };
    
    setOutputMessages(prev => [newMessage, ...prev]);
    
    // Also save to database for multiplayer
    try {
      await room.collection('gameMessages').create({
        messageType: type,
        text,
        details,
        imageUrl
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
    
    return newMessage;
  }, []);
  
  // Add a system message (helper function)
  const addSystemMessage = useCallback((text, details = null) => {
    return addOutputMessage('system', text, details);
  }, [addOutputMessage]);
  
  // Handle command submission
  const handleSubmitCommand = useCallback(async () => {
    if (!command.trim() || isProcessing) return;
    
    setIsProcessing(true);
    
    // Add the command to history
    const trimmedCommand = command.trim();
    setGameState(prev => ({
      ...prev,
      commandHistory: [trimmedCommand, ...prev.commandHistory.slice(0, 19)],
      lastCommand: trimmedCommand
    }));
    
    // Add the command to the output area
    addSystemMessage(`> ${trimmedCommand}`, null);
    
    // Notify other players about the command
    room.send({
      type: "command",
      command: trimmedCommand
    });
    
    // Process the command with the LLM
    try {
      // Format the request to the LLM
      const completion = await websim.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are the game engine for "Stellar Evolution", a text-based space civilization game. 
            Process the player's natural language commands and return structured JSON responses that update the game state.
            
            The player is guiding a civilization from early space exploration to galactic empire. Each command should be interpreted
            as a directive to their civilization and should update resources, trigger events, advance research, etc.
            
            Categorize all actions into one of these types:
            - EXPLORATION: Discovering new celestial bodies or features
            - RESEARCH: Advancing technologies
            - CONSTRUCTION: Building structures or vessels
            - COLONIZATION: Establishing new settlements
            - PRODUCTION: Manufacturing resources or items
            - DIPLOMACY: Interacting with other civilizations
            - MANAGEMENT: Redistributing resources or population
            - SPECIAL_EVENT: Unique occurrences
            
            Return your response in this JSON format:
            {
              "action": {
                "type": "ACTION_TYPE",
                "subtype": "SPECIFIC_ACTION",
                "target": "target-id",
                "resources": { resource changes },
                "success": true/false
              },
              "gameStateChanges": {
                // Changes to apply to the game state
              },
              "narrative": {
                "mainText": "Main response text",
                "detailText": "Additional details",
                "tone": "system/exploration/positive/warning/danger",
                "imagePrompt": "Prompt for image generation if needed"
              }
            }
            
            Be creative but consistent with sci-fi logic. Make sure resource costs and technology requirements make sense.`
          },
          {
            role: "user",
            content: `Current game state: ${JSON.stringify(gameState)}
            
            Player command: "${trimmedCommand}"
            
            Generate a response that processes this command and updates the game state appropriately.`
          }
        ]
      });
      
      // Parse the response
      let response;
      try {
        const content = completion.content;
        // Extract JSON from the response if it's wrapped in code blocks
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```([\s\S]*?)```/) || [null, content];
        response = JSON.parse(jsonMatch[1] || content);
      } catch (error) {
        console.error('Error parsing LLM response:', error);
        addOutputMessage('warning', 'Error processing command. Please try again.', null);
        setIsProcessing(false);
        setCommand('');
        return;
      }
      
      // Process narrative
      if (response.narrative) {
        const { mainText, detailText, tone, imagePrompt } = response.narrative;
        
        // Generate image if there's an image prompt
        let imageUrl = null;
        if (imagePrompt) {
          try {
            const imageResult = await websim.imageGen({
              prompt: imagePrompt,
              aspect_ratio: "16:9"
            });
            imageUrl = imageResult.url;
          } catch (error) {
            console.error('Error generating image:', error);
          }
        }
        
        // Add the narrative to the output
        addOutputMessage(tone || 'system', mainText, detailText, imageUrl);
      }
      
      // Update game state
      if (response.gameStateChanges) {
        setGameState(prev => {
          const newState = { ...prev };
          
          // Apply resource changes
          if (response.gameStateChanges.resources) {
            Object.entries(response.gameStateChanges.resources).forEach(([resource, change]) => {
              if (newState.resources[resource] !== undefined) {
                newState.resources[resource] += change;
              }
            });
          }
          
          // Add new events
          if (response.gameStateChanges.events && Array.isArray(response.gameStateChanges.events)) {
            newState.events = [...response.gameStateChanges.events, ...newState.events];
          }
          
          // Add new facilities
          if (response.gameStateChanges.facilities && Array.isArray(response.gameStateChanges.facilities)) {
            // Find the right colony to add facilities to
            if (response.action && response.action.target) {
              const targetColony = newState.colonies.find(colony => colony.id === response.action.target || colony.planetId === response.action.target);
              if (targetColony) {
                targetColony.facilities = [...response.gameStateChanges.facilities, ...targetColony.facilities];
              }
            }
          }
          
          // Update technologies
          if (response.gameStateChanges.technologies) {
            newState.technologies = newState.technologies.map(tech => {
              const updatedTech = response.gameStateChanges.technologies.find(t => t.id === tech.id);
              return updatedTech ? { ...tech, ...updatedTech } : tech;
            });
          }
          
          // Handle star system discoveries
          if (response.gameStateChanges.starSystems) {
            // Update existing systems
            newState.starSystems = newState.starSystems.map(system => {
              const updatedSystem = response.gameStateChanges.starSystems.find(s => s.id === system.id);
              if (updatedSystem) {
                // Deep merge for bodies
                if (updatedSystem.bodies && system.bodies) {
                  updatedSystem.bodies = system.bodies.map(body => {
                    const updatedBody = updatedSystem.bodies.find(b => b.id === body.id);
                    return updatedBody ? { ...body, ...updatedBody } : body;
                  });
                  
                  // Add new bodies that weren't in the original
                  const existingIds = new Set(system.bodies.map(b => b.id));
                  const newBodies = updatedSystem.bodies.filter(b => !existingIds.has(b.id));
                  updatedSystem.bodies = [...updatedSystem.bodies, ...newBodies];
                }
                
                return { ...system, ...updatedSystem };
              }
              return system;
            });
            
            // Add completely new star systems
            const existingIds = new Set(newState.starSystems.map(s => s.id));
            const newSystems = response.gameStateChanges.starSystems.filter(s => !existingIds.has(s.id));
            if (newSystems.length > 0) {
              newState.starSystems = [...newState.starSystems, ...newSystems];
            }
          }
          
          // Handle new colonies
          if (response.gameStateChanges.colonies) {
            // Update existing colonies
            newState.colonies = newState.colonies.map(colony => {
              const updatedColony = response.gameStateChanges.colonies.find(c => c.id === colony.id);
              return updatedColony ? { ...colony, ...updatedColony } : colony;
            });
            
            // Add new colonies
            const existingIds = new Set(newState.colonies.map(c => c.id));
            const newColonies = response.gameStateChanges.colonies.filter(c => !existingIds.has(c.id));
            if (newColonies.length > 0) {
              newState.colonies = [...newState.colonies, ...newColonies];
            }
          }
          
          // Advance turn
          newState.turn += 1;
          newState.turnStartTime = Date.now();
          
          return newState;
        });
      }
      
      // Broadcast updated game state to other players
      room.send({
        type: "gameState",
        state: gameState,
        narrative: response.narrative
      });
      
    } catch (error) {
      console.error('Error processing command:', error);
      addOutputMessage('warning', 'Error processing command. Please try again.', null);
    } finally {
      setIsProcessing(false);
      setCommand('');
    }
  }, [command, isProcessing, gameState, addOutputMessage, addSystemMessage]);
  
  // Handle Enter key in input field
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitCommand();
    }
  };
  
  // Format large numbers for display
  const formatNumber = (num) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toString();
  };
  
  // Render stars in the background
  const StarsBackground = () => {
    const starsRef = useRef(null);
    
    // Create stars on mount
    useEffect(() => {
      if (!starsRef.current) return;
      
      const container = starsRef.current;
      const starCount = Math.floor(window.innerWidth * window.innerHeight / 1000);
      
      for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        
        // Random position
        const left = Math.random() * 100;
        const top = Math.random() * 100;
        
        // Random size (mostly small)
        const size = Math.random() * 2 + 1;
        
        // Random opacity for twinkling effect
        const opacity = Math.random() * 0.7 + 0.3;
        
        star.style.cssText = `
          position: absolute;
          left: ${left}%;
          top: ${top}%;
          width: ${size}px;
          height: ${size}px;
          background-color: rgba(255, 255, 255, ${opacity});
          border-radius: 50%;
          box-shadow: 0 0 ${size * 2}px rgba(255, 255, 255, 0.7);
        `;
        
        container.appendChild(star);
      }
    }, []);
    
    return <div ref={starsRef} className="stars-container"></div>;
  };
  
  return (
    <div className="game-container">
      <StarsBackground />
      
      <header className="game-header">
        <div className="game-title">Stellar Evolution</div>
        <div>Turn {gameState.turn}</div>
      </header>
      
      <div className="status-bar">
        <div className="status-item">
          <span className="status-item-name">Energy:</span>
          <span className="status-item-value resource-energy">{formatNumber(gameState.resources.energy)}</span>
        </div>
        <div className="status-item">
          <span className="status-item-name">Minerals:</span>
          <span className="status-item-value resource-minerals">{formatNumber(gameState.resources.minerals)}</span>
        </div>
        <div className="status-item">
          <span className="status-item-name">Knowledge:</span>
          <span className="status-item-value resource-knowledge">{formatNumber(gameState.resources.knowledge)}</span>
        </div>
        <div className="status-item">
          <span className="status-item-name">Population:</span>
          <span className="status-item-value resource-population">{formatNumber(gameState.resources.population)}</span>
        </div>
        <div className="status-item">
          <span className="status-item-name">Civilizations:</span>
          <span className="status-item-value">{Object.keys(peers).length}</span>
        </div>
      </div>
      
      <main className="game-content">
        <div className="output-area" ref={outputRef}>
          {outputMessages.map((message, index) => (
            <div key={message.id || index} className={`output-message message-${message.type}`}>
              <div className="output-timestamp">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
              <div className="output-text">{message.text}</div>
              {message.details && (
                <div className="output-detail">{message.details}</div>
              )}
              {message.imageUrl && (
                <img src={message.imageUrl} alt="Generated scene" className="output-image" />
              )}
            </div>
          ))}
          
          {isProcessing && (
            <div className="loading-indicator">
              <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="0" fill="currentColor">
                  <animate attributeName="r" values="0;8;0" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;1;0" dur="1.5s" repeatCount="indefinite" />
                </circle>
              </svg>
              Processing command...
            </div>
          )}
        </div>
        
        <div className="input-area">
          <input
            type="text"
            className="command-input"
            placeholder="Enter your command..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
          />
          <button
            className="send-button"
            onClick={handleSubmitCommand}
            disabled={isProcessing || !command.trim()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </main>
    </div>
  );
}

// Initialize the React app
const rootElement = document.getElementById('app');
const root = createRoot(rootElement);
root.render(<Game />);

