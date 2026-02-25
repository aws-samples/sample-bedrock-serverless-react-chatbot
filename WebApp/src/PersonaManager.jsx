// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect, useContext } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { PersonaService } from './PersonaService';
import PersonaDocumentUpload from './PersonaDocumentUpload';
import { config } from './aws-config';
// Remove icon from imports since we're not using it anymore
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Table,
  Box,
  Modal,
  Form,
  FormField,
  Input,
  Textarea,
  Alert,
  StatusIndicator,
  Popover
} from '@cloudscape-design/components';

const PersonaManager = ({ onPersonasChange }) => {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPersonas, setSelectedPersonas] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    prompt: '',
    documents: []
  });
  const [formErrors, setFormErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [userEmail, setUserEmail] = useState('');

  const credentials = useContext(CredentialsContext);

  useEffect(() => {
    const initializeUser = async () => {
      try {
        const attributes = await fetchUserAttributes();
        setUserEmail(attributes.email);
      } catch (error) {
        console.error('Error fetching user attributes:', error);
      }
    };
    initializeUser();
  }, []);

  useEffect(() => {
    if (userEmail && credentials) {
      loadPersonas();
    }
  }, [userEmail, credentials]);

  const loadPersonas = async () => {
    try {
      setLoading(true);
      
      // Initialize default personas if needed
      await PersonaService.initializeDefaultPersonas(userEmail, credentials);
      
      // Load all personas
      const userPersonas = await PersonaService.getUserPersonas(userEmail, credentials);
      setPersonas(userPersonas);
      
      // Notify parent component of persona changes
      if (onPersonasChange) {
        if (config.debug) console.log('PersonaManager calling onPersonasChange callback');
        onPersonasChange();
      }
    } catch (error) {
      console.error('Error loading personas:', error);
      setAlert({
        type: 'error',
        content: 'Failed to load personas. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }
    
    if (!formData.description.trim()) {
      errors.description = 'Description is required';
    }
    
    if (!formData.prompt.trim()) {
      errors.prompt = 'Prompt is required';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreatePersona = async () => {
    if (!validateForm()) return;

    try {
      const newPersona = {
        ...formData,
        isDefault: false,
        isSystem: false
      };

      await PersonaService.savePersona(userEmail, newPersona, credentials);
      
      setAlert({
        type: 'success',
        content: 'Persona created successfully!'
      });
      
      setShowCreateModal(false);
      resetForm();
      await loadPersonas();
    } catch (error) {
      console.error('Error creating persona:', error);
      setAlert({
        type: 'error',
        content: 'Failed to create persona. Please try again.'
      });
    }
  };

  const handleEditPersona = async () => {
    if (!validateForm()) return;

    try {
      const updatedPersona = {
        ...editingPersona,
        ...formData
      };

      await PersonaService.savePersona(userEmail, updatedPersona, credentials);
      
      setAlert({
        type: 'success',
        content: 'Persona updated successfully!'
      });
      
      setShowEditModal(false);
      setEditingPersona(null);
      resetForm();
      await loadPersonas();
    } catch (error) {
      console.error('Error updating persona:', error);
      setAlert({
        type: 'error',
        content: 'Failed to update persona. Please try again.'
      });
    }
  };

  const handleDeletePersonas = async () => {
    try {
      for (const persona of selectedPersonas) {
        if (!persona.isSystem) {
          await PersonaService.deletePersona(userEmail, persona.id, credentials);
        }
      }
      
      setAlert({
        type: 'success',
        content: `Successfully deleted ${selectedPersonas.filter(p => !p.isSystem).length} persona(s)!`
      });
      
      setSelectedPersonas([]);
      await loadPersonas();
    } catch (error) {
      console.error('Error deleting personas:', error);
      setAlert({
        type: 'error',
        content: 'Failed to delete some personas. Please try again.'
      });
    }
  };

  const handleResetToDefaults = async () => {
    try {
      await PersonaService.resetToDefaultPersonas(userEmail, credentials);
      
      setAlert({
        type: 'success',
        content: 'Successfully reset to default personas! All custom personas have been removed.'
      });
      
      setSelectedPersonas([]);
      await loadPersonas();
    } catch (error) {
      console.error('Error resetting to defaults:', error);
      setAlert({
        type: 'error',
        content: 'Failed to reset to defaults. Please try again.'
      });
    }
  };

  const openEditModal = (persona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      description: persona.description,
      prompt: persona.prompt,
      documents: persona.documents || []
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      prompt: '',
      documents: []
    });
    setFormErrors({});
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingPersona(null);
    resetForm();
  };

  const canDeleteSelected = selectedPersonas.length > 0 && selectedPersonas.some(p => !p.isSystem);

  if (config.debug) {
    console.log('Selected personas:', selectedPersonas);
    console.log('Can delete selected:', canDeleteSelected);
    console.log('Selected personas details:', selectedPersonas.map(p => ({ id: p.id, name: p.name, isSystem: p.isSystem })));
  }

  return (
    <Container>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          description="Manage your AI personas. Create custom personas or modify existing ones to suit your specific needs."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                onClick={() => setShowCreateModal(true)}
                variant="primary"
                iconName="add-plus"
              >
                Create Persona
              </Button>
              <Button
                onClick={handleDeletePersonas}
                disabled={!canDeleteSelected}
                iconName="remove"
                title={
                  selectedPersonas.length === 0 
                    ? "Select personas to delete" 
                    : !canDeleteSelected 
                    ? "Only custom personas can be deleted (system personas are protected)"
                    : "Delete selected custom personas"
                }
              >
                Delete Selected
              </Button>
              <Button
                onClick={handleResetToDefaults}
                iconName="undo"
                variant="normal"
              >
                Reset to Defaults
              </Button>
              <Button
                onClick={loadPersonas}
                iconName="refresh"
                loading={loading}
              >
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Persona Management
        </Header>

        {alert && (
          <Alert
            type={alert.type}
            dismissible
            onDismiss={() => setAlert(null)}
          >
            {alert.content}
          </Alert>
        )}

        <Table
          columnDefinitions={[
            {
              id: 'name',
              header: 'Name',
              cell: item => (
                <Box>
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <span>{item.name}</span>
                    {item.isDefault && (
                      <StatusIndicator type="success">Default</StatusIndicator>
                    )}
                    {item.isSystem && (
                      <StatusIndicator type="info">System</StatusIndicator>
                    )}
                    {!item.isSystem && !item.isDefault && (
                      <StatusIndicator type="warning">Custom</StatusIndicator>
                    )}
                  </SpaceBetween>
                </Box>
              ),
              sortingField: 'name'
            },
            {
              id: 'description',
              header: 'Description',
              cell: item => item.description,
              sortingField: 'description'
            },
            {
              id: 'documents',
              header: 'Documents',
              cell: item => (
                <Box>
                  {item.documents && item.documents.length > 0 ? (
                    <StatusIndicator type="success">
                      {item.documents.length} document{item.documents.length !== 1 ? 's' : ''}
                    </StatusIndicator>
                  ) : (
                    <StatusIndicator type="info">No documents</StatusIndicator>
                  )}
                </Box>
              )
            },
            {
              id: 'prompt',
              header: 'Prompt',
              cell: item => (
                <Box>
                  {item.prompt ? (
                    <Popover
                      dismissButton={false}
                      position="top"
                      size="large"
                      triggerType="custom"
                      content={
                        <Box>
                          <Box variant="small" color="text-body-secondary">
                            System Prompt:
                          </Box>
                          <Box variant="p" fontSize="body-s">
                            {item.prompt}
                          </Box>
                        </Box>
                      }
                    >
                      <Button variant="inline-link">
                        {item.prompt.length > 50 
                          ? `${item.prompt.substring(0, 47)}...` 
                          : item.prompt}
                      </Button>
                    </Popover>
                  ) : (
                    <Box color="text-body-secondary">No prompt</Box>
                  )}
                </Box>
              )
            },
            {
              id: 'actions',
              header: 'Actions',
              cell: item => (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    onClick={() => openEditModal(item)}
                    variant="inline-link"
                    iconName="edit"
                  >
                    Edit
                  </Button>
                </SpaceBetween>
              ),
              width: 100
            }
          ]}
          items={personas}
          loading={loading}
          selectedItems={selectedPersonas}
          onSelectionChange={({ detail }) => {
            if (config.debug) {
              console.log('Selection changed:', detail.selectedItems);
              console.log('Selected items details:', detail.selectedItems.map(p => ({ 
                id: p.id, 
                name: p.name, 
                isSystem: p.isSystem,
                isDefault: p.isDefault 
              })));
            }
            setSelectedPersonas(detail.selectedItems);
          }}
          selectionType="multi"
          trackBy="id"
          empty={
            <Box textAlign="center" color="inherit">
              <b>No personas found</b>
              <Box variant="p" color="inherit">
                Create your first custom persona to get started.
              </Box>
            </Box>
          }
          sortingDisabled={false}
        />

        {/* Create Persona Modal */}
        <Modal
          visible={showCreateModal}
          onDismiss={closeCreateModal}
          header="Create New Persona"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={closeCreateModal}>Cancel</Button>
                <Button onClick={handleCreatePersona} variant="primary">
                  Create Persona
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <Form>
            <SpaceBetween size="l">
              <FormField
                label="Name"
                errorText={formErrors.name}
                description="A descriptive name for your persona"
              >
                <Input
                  value={formData.name}
                  onChange={({ detail }) => setFormData({ ...formData, name: detail.value })}
                  placeholder="e.g., Marketing Expert"
                />
              </FormField>

              <FormField
                label="Description"
                errorText={formErrors.description}
                description="Brief description of what this persona specializes in"
              >
                <Input
                  value={formData.description}
                  onChange={({ detail }) => setFormData({ ...formData, description: detail.value })}
                  placeholder="e.g., Specializes in marketing strategy and content creation"
                />
              </FormField>

              <FormField
                label="System Prompt"
                errorText={formErrors.prompt}
                description="The instructions that will guide this persona's behavior and responses"
              >
                <Textarea
                  value={formData.prompt}
                  onChange={({ detail }) => setFormData({ ...formData, prompt: detail.value })}
                  placeholder="You are a marketing expert with extensive experience in digital marketing, brand strategy, and content creation. Provide actionable marketing advice that considers current trends, target audience analysis, and measurable outcomes..."
                  rows={6}
                />
              </FormField>

              <PersonaDocumentUpload
                persona={{ s3Prefix: `personas/${userEmail}/new/`, documents: formData.documents }}
                onDocumentsChange={(docs) => setFormData({ ...formData, documents: docs })}
              />
            </SpaceBetween>
          </Form>
        </Modal>

        {/* Edit Persona Modal */}
        <Modal
          visible={showEditModal}
          onDismiss={closeEditModal}
          header={`Edit Persona: ${editingPersona?.name || ''}`}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={closeEditModal}>Cancel</Button>
                <Button onClick={handleEditPersona} variant="primary">
                  Save Changes
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <Form>
            <SpaceBetween size="l">
              <FormField
                label="Name"
                errorText={formErrors.name}
                description="A descriptive name for your persona"
              >
                <Input
                  value={formData.name}
                  onChange={({ detail }) => setFormData({ ...formData, name: detail.value })}
                  placeholder="e.g., Marketing Expert"
                />
              </FormField>

              <FormField
                label="Description"
                errorText={formErrors.description}
                description="Brief description of what this persona specializes in"
              >
                <Input
                  value={formData.description}
                  onChange={({ detail }) => setFormData({ ...formData, description: detail.value })}
                  placeholder="e.g., Specializes in marketing strategy and content creation"
                />
              </FormField>

              <FormField
                label="System Prompt"
                errorText={formErrors.prompt}
                description="The instructions that will guide this persona's behavior and responses"
              >
                <Textarea
                  value={formData.prompt}
                  onChange={({ detail }) => setFormData({ ...formData, prompt: detail.value })}
                  placeholder="You are a marketing expert with extensive experience in digital marketing, brand strategy, and content creation. Provide actionable marketing advice that considers current trends, target audience analysis, and measurable outcomes..."
                  rows={6}
                />
              </FormField>

              {editingPersona && (
                <PersonaDocumentUpload
                  persona={editingPersona}
                  onDocumentsChange={(docs) => setFormData({ ...formData, documents: docs })}
                />
              )}
            </SpaceBetween>
          </Form>
        </Modal>
      </SpaceBetween>
    </Container>
  );
};

export default PersonaManager;